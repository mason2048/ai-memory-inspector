use crate::{error::CoreError, vault::VaultKey};
use security_framework::{
    access_control::{ProtectionMode, SecAccessControl},
    passwords::{generic_password, AccessControlOptions, PasswordOptions},
};
use security_framework_sys::base::{errSecAuthFailed, errSecItemNotFound};
use zeroize::{Zeroize, ZeroizeOnDrop};

const SERVICE: &str = "com.localfirst.aimemoryinspector.vault";
const ACCOUNT: &str = "device-master-key-v1";
const KEY_BYTES: usize = 32;

#[derive(Debug, Zeroize, ZeroizeOnDrop)]
pub struct KeychainMasterKey([u8; KEY_BYTES]);

impl KeychainMasterKey {
    pub fn generate() -> Result<Self, CoreError> {
        let mut bytes = [0_u8; KEY_BYTES];
        getrandom::fill(&mut bytes)
            .map_err(|error| CoreError::Io(std::io::Error::other(error.to_string())))?;
        Ok(Self(bytes))
    }

    fn from_slice(bytes: &[u8]) -> Result<Self, CoreError> {
        let value: [u8; KEY_BYTES] = bytes.try_into().map_err(|_| CoreError::InvalidVault)?;
        Ok(Self(value))
    }

    /// Transfers ownership of the protected random key into the in-memory
    /// vault key without converting it to text or deriving a second key.
    pub fn into_vault_key(mut self) -> VaultKey {
        let bytes = std::mem::take(&mut self.0);
        VaultKey::new(bytes)
    }

    /// Checks every byte before returning. The compared keys never need to be
    /// formatted, logged, or exposed to the caller.
    pub fn verify_readback(&self, readback: &Self) -> Result<(), CoreError> {
        let difference = self
            .0
            .iter()
            .zip(readback.0.iter())
            .fold(0_u8, |difference, (expected, actual)| {
                difference | (expected ^ actual)
            });
        if difference == 0 {
            Ok(())
        } else {
            Err(CoreError::AuthenticationFailed)
        }
    }

    /// Consumes the generated candidate and returns only an exact protected
    /// readback. On every failure path both key allocations are zeroized by
    /// their drop implementations.
    pub fn accept_verified_readback(self, readback: Option<Self>) -> Result<Self, CoreError> {
        let readback = readback.ok_or(CoreError::AuthenticationFailed)?;
        self.verify_readback(&readback)?;
        Ok(readback)
    }
}

#[derive(Debug, Clone, Copy)]
pub struct SystemKeychain {
    service: &'static str,
    account: &'static str,
}

impl SystemKeychain {
    pub const fn production() -> Self {
        Self {
            service: SERVICE,
            account: ACCOUNT,
        }
    }

    fn options(&self) -> PasswordOptions {
        let mut options = PasswordOptions::new_generic_password(self.service, self.account);
        options.use_protected_keychain();
        options.set_access_synchronized(Some(false));
        options.set_label("AI Memory Inspector 本地主密钥");
        options
    }

    /// Creates or updates the protected item using security-framework's safe
    /// PasswordOptions API. Callers must hold the cross-process lifecycle lock,
    /// call this only after a protected read returned not-found, then perform an
    /// immediate protected readback and verify it against `key`.
    ///
    /// security-framework 3.7's safe add-only ItemAddOptions cannot attach a
    /// SecAccessControl, while its legacy add-only generic-password API cannot
    /// attach this SecAccessControl/Data Protection policy either. The safe
    /// protected PasswordOptions API intentionally has create-or-update
    /// semantics, so this method makes no duplicate-item claim.
    pub fn store_master_key(&self, key: &KeychainMasterKey) -> Result<(), CoreError> {
        let access = SecAccessControl::create_with_protection(
            Some(ProtectionMode::AccessibleWhenPasscodeSetThisDeviceOnly),
            AccessControlOptions::USER_PRESENCE.bits(),
        )
        .map_err(|_| CoreError::BackendUnavailable)?;
        let mut options = self.options();
        options.set_access_control(access);
        security_framework::passwords::set_generic_password_options(&key.0, options)
            .map_err(map_keychain_error)
    }

    pub fn read_master_key(&self) -> Result<Option<KeychainMasterKey>, CoreError> {
        match generic_password(self.options()) {
            Ok(mut bytes) => {
                let key = KeychainMasterKey::from_slice(&bytes);
                bytes.zeroize();
                key.map(Some)
            }
            Err(error) if error.code() == errSecItemNotFound => Ok(None),
            Err(error) => Err(map_keychain_error(error)),
        }
    }
}

fn map_keychain_error(error: security_framework::base::Error) -> CoreError {
    let code = error.code();
    if code == -128 {
        CoreError::AuthenticationCancelled
    } else if code == errSecAuthFailed || code == -25308 {
        CoreError::AuthenticationFailed
    } else {
        CoreError::BackendUnavailable
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_master_key_transfers_directly_and_is_unique() {
        let first = KeychainMasterKey::generate().unwrap().into_vault_key();
        let second = KeychainMasterKey::generate().unwrap().into_vault_key();
        assert_ne!(first.bytes(), second.bytes());
        assert_ne!(first.bytes(), &[0; KEY_BYTES]);
    }

    #[test]
    fn readback_verification_accepts_only_the_complete_same_key() {
        let expected = KeychainMasterKey::from_slice(&[0x5a; KEY_BYTES]).unwrap();
        let same = KeychainMasterKey::from_slice(&[0x5a; KEY_BYTES]).unwrap();
        assert!(expected.verify_readback(&same).is_ok());
        for position in 0..KEY_BYTES {
            let mut different_bytes = [0x5a; KEY_BYTES];
            different_bytes[position] ^= 1;
            let different = KeychainMasterKey::from_slice(&different_bytes).unwrap();
            assert!(matches!(
                expected.verify_readback(&different),
                Err(CoreError::AuthenticationFailed)
            ));
        }
    }

    #[test]
    fn generated_candidate_requires_a_present_matching_readback() {
        let expected = || KeychainMasterKey::from_slice(&[0x6b; KEY_BYTES]).unwrap();
        let matching = KeychainMasterKey::from_slice(&[0x6b; KEY_BYTES]).unwrap();
        assert!(expected().accept_verified_readback(Some(matching)).is_ok());
        assert!(matches!(
            expected().accept_verified_readback(None),
            Err(CoreError::AuthenticationFailed)
        ));
        assert!(matches!(
            expected().accept_verified_readback(Some(
                KeychainMasterKey::from_slice(&[0x6c; KEY_BYTES]).unwrap()
            )),
            Err(CoreError::AuthenticationFailed)
        ));
    }

    #[test]
    fn keychain_status_mapping_never_contains_native_details() {
        assert!(matches!(
            map_keychain_error(security_framework::base::Error::from_code(-128)),
            CoreError::AuthenticationCancelled
        ));
        assert!(matches!(
            map_keychain_error(security_framework::base::Error::from_code(errSecAuthFailed)),
            CoreError::AuthenticationFailed
        ));
    }
}
