# Third-Party Notices

This inventory covers production npm dependencies from `package-lock.json` and normal Rust
dependencies reachable from `src-tauri/Cargo.lock` for both supported macOS architectures.
Build-only and test-only dependencies are excluded. It is an inventory, not a substitute for the
license text or attribution requirements supplied by each dependency.

Regenerate after either lock file changes:

```bash
npm run license:write
```

CI verifies that this committed file is current with `npm run license:check`. The verifier rejects
missing or unknown license fields and GPL, AGPL, or SSPL license expressions.

## npm production dependencies

| Package   | Version | License |
| --------- | ------- | ------- |
| react     | 19.2.8  | MIT     |
| react-dom | 19.2.8  | MIT     |
| scheduler | 0.27.0  | MIT     |

## Rust production dependencies

| Package                      | Version          | License                                             |
| ---------------------------- | ---------------- | --------------------------------------------------- |
| adler2                       | 2.0.1            | 0BSD OR MIT OR Apache-2.0                           |
| aead                         | 0.5.2            | MIT OR Apache-2.0                                   |
| aes                          | 0.8.4            | MIT OR Apache-2.0                                   |
| aes-gcm                      | 0.10.3           | Apache-2.0 OR MIT                                   |
| aho-corasick                 | 1.1.5            | Unlicense OR MIT                                    |
| anyhow                       | 1.0.104          | MIT OR Apache-2.0                                   |
| argon2                       | 0.5.3            | MIT OR Apache-2.0                                   |
| base64                       | 0.21.7           | MIT OR Apache-2.0                                   |
| base64                       | 0.22.1           | MIT OR Apache-2.0                                   |
| base64ct                     | 1.8.3            | Apache-2.0 OR MIT                                   |
| bit-set                      | 0.8.0            | Apache-2.0 OR MIT                                   |
| bit-vec                      | 0.8.0            | Apache-2.0 OR MIT                                   |
| bitflags                     | 1.3.2            | MIT/Apache-2.0                                      |
| bitflags                     | 2.13.1           | MIT OR Apache-2.0                                   |
| blake2                       | 0.10.6           | MIT OR Apache-2.0                                   |
| block-buffer                 | 0.10.4           | MIT OR Apache-2.0                                   |
| block2                       | 0.6.2            | MIT                                                 |
| bs58                         | 0.5.1            | MIT/Apache-2.0                                      |
| byteorder                    | 1.5.0            | Unlicense OR MIT                                    |
| bytes                        | 1.12.1           | MIT                                                 |
| camino                       | 1.2.5            | MIT OR Apache-2.0                                   |
| cargo_metadata               | 0.19.2           | MIT                                                 |
| cargo-platform               | 0.1.9            | MIT OR Apache-2.0                                   |
| cfb                          | 0.7.3            | MIT                                                 |
| cfg-if                       | 1.0.4            | MIT OR Apache-2.0                                   |
| chrono                       | 0.4.45           | MIT OR Apache-2.0                                   |
| cipher                       | 0.4.4            | MIT OR Apache-2.0                                   |
| cookie                       | 0.18.2           | MIT OR Apache-2.0                                   |
| core-foundation              | 0.10.1           | MIT OR Apache-2.0                                   |
| core-foundation-sys          | 0.8.7            | MIT OR Apache-2.0                                   |
| core-graphics                | 0.25.0           | MIT OR Apache-2.0                                   |
| core-graphics-types          | 0.2.0            | MIT OR Apache-2.0                                   |
| cpufeatures                  | 0.2.17           | MIT OR Apache-2.0                                   |
| crc32fast                    | 1.5.0            | MIT OR Apache-2.0                                   |
| crossbeam-channel            | 0.5.16           | MIT OR Apache-2.0                                   |
| crossbeam-utils              | 0.8.22           | MIT OR Apache-2.0                                   |
| crypto-common                | 0.1.7            | MIT OR Apache-2.0                                   |
| cssparser                    | 0.36.0           | MPL-2.0                                             |
| cssparser-macros             | 0.6.1            | MPL-2.0                                             |
| ctor                         | 0.8.0            | Apache-2.0 OR MIT                                   |
| ctor-proc-macro              | 0.0.7            | Apache-2.0 OR MIT                                   |
| ctr                          | 0.9.2            | MIT OR Apache-2.0                                   |
| darling                      | 0.23.0           | MIT                                                 |
| darling_core                 | 0.23.0           | MIT                                                 |
| darling_macro                | 0.23.0           | MIT                                                 |
| defmt                        | 1.1.1            | MIT OR Apache-2.0                                   |
| defmt-macros                 | 1.1.1            | MIT OR Apache-2.0                                   |
| defmt-parser                 | 1.0.0            | MIT OR Apache-2.0                                   |
| deranged                     | 0.5.8            | MIT OR Apache-2.0                                   |
| derive_more                  | 2.1.1            | MIT                                                 |
| derive_more-impl             | 2.1.1            | MIT                                                 |
| digest                       | 0.10.7           | MIT OR Apache-2.0                                   |
| dirs                         | 6.0.0            | MIT OR Apache-2.0                                   |
| dirs-sys                     | 0.5.0            | MIT OR Apache-2.0                                   |
| dispatch2                    | 0.3.1            | Zlib OR Apache-2.0 OR MIT                           |
| displaydoc                   | 0.2.7            | MIT OR Apache-2.0                                   |
| dom_query                    | 0.27.0           | MIT                                                 |
| dpi                          | 0.1.2            | Apache-2.0 AND MIT                                  |
| dtoa                         | 1.0.11           | MIT OR Apache-2.0                                   |
| dtoa-short                   | 0.3.5            | MPL-2.0                                             |
| dtor                         | 0.3.0            | Apache-2.0 OR MIT                                   |
| dtor-proc-macro              | 0.0.6            | Apache-2.0 OR MIT                                   |
| dunce                        | 1.0.5            | CC0-1.0 OR MIT-0 OR Apache-2.0                      |
| dyn-clone                    | 1.0.20           | MIT OR Apache-2.0                                   |
| embed_plist                  | 1.2.2            | MIT OR Apache-2.0                                   |
| equivalent                   | 1.0.2            | Apache-2.0 OR MIT                                   |
| erased-serde                 | 0.4.10           | MIT OR Apache-2.0                                   |
| errno                        | 0.3.14           | MIT OR Apache-2.0                                   |
| fastrand                     | 2.5.0            | Apache-2.0 OR MIT                                   |
| fdeflate                     | 0.3.7            | MIT OR Apache-2.0                                   |
| flate2                       | 1.1.9            | MIT OR Apache-2.0                                   |
| fnv                          | 1.0.7            | Apache-2.0 / MIT                                    |
| foldhash                     | 0.2.0            | Zlib                                                |
| foreign-types                | 0.5.0            | MIT/Apache-2.0                                      |
| foreign-types-macros         | 0.2.4            | MIT/Apache-2.0                                      |
| foreign-types-shared         | 0.3.1            | MIT/Apache-2.0                                      |
| form_urlencoded              | 1.2.2            | MIT OR Apache-2.0                                   |
| fs4                          | 1.1.0            | MIT OR Apache-2.0                                   |
| generic-array                | 0.14.7           | MIT                                                 |
| getrandom                    | 0.2.17           | MIT OR Apache-2.0                                   |
| getrandom                    | 0.3.4            | MIT OR Apache-2.0                                   |
| getrandom                    | 0.4.3            | MIT OR Apache-2.0                                   |
| ghash                        | 0.5.1            | Apache-2.0 OR MIT                                   |
| glob                         | 0.3.4            | MIT OR Apache-2.0                                   |
| hashbrown                    | 0.12.3           | MIT OR Apache-2.0                                   |
| hashbrown                    | 0.17.1           | MIT OR Apache-2.0                                   |
| heck                         | 0.5.0            | MIT OR Apache-2.0                                   |
| hex                          | 0.4.3            | MIT OR Apache-2.0                                   |
| html5ever                    | 0.38.0           | MIT OR Apache-2.0                                   |
| http                         | 1.5.0            | MIT OR Apache-2.0                                   |
| iana-time-zone               | 0.1.65           | MIT OR Apache-2.0                                   |
| ico                          | 0.5.0            | MIT                                                 |
| icu_collections              | 2.2.0            | Unicode-3.0                                         |
| icu_locale_core              | 2.2.0            | Unicode-3.0                                         |
| icu_normalizer               | 2.2.0            | Unicode-3.0                                         |
| icu_normalizer_data          | 2.2.0            | Unicode-3.0                                         |
| icu_properties               | 2.2.0            | Unicode-3.0                                         |
| icu_properties_data          | 2.2.0            | Unicode-3.0                                         |
| icu_provider                 | 2.2.0            | Unicode-3.0                                         |
| ident_case                   | 1.0.1            | MIT/Apache-2.0                                      |
| idna                         | 1.1.0            | MIT OR Apache-2.0                                   |
| idna_adapter                 | 1.2.2            | Apache-2.0 OR MIT                                   |
| indexmap                     | 1.9.3            | Apache-2.0 OR MIT                                   |
| indexmap                     | 2.14.0           | Apache-2.0 OR MIT                                   |
| infer                        | 0.19.0           | MIT                                                 |
| inout                        | 0.1.4            | MIT OR Apache-2.0                                   |
| itoa                         | 1.0.18           | MIT OR Apache-2.0                                   |
| jiff                         | 0.2.35           | Unlicense OR MIT                                    |
| jiff-core                    | 0.1.0            | Unlicense OR MIT                                    |
| json-patch                   | 3.0.1            | MIT/Apache-2.0                                      |
| jsonptr                      | 0.6.3            | MIT OR Apache-2.0                                   |
| keyboard-types               | 0.7.0            | MIT OR Apache-2.0                                   |
| libc                         | 0.2.189          | MIT OR Apache-2.0                                   |
| litemap                      | 0.8.2            | Unicode-3.0                                         |
| lock_api                     | 0.4.14           | MIT OR Apache-2.0                                   |
| log                          | 0.4.33           | MIT OR Apache-2.0                                   |
| markup5ever                  | 0.38.0           | MIT OR Apache-2.0                                   |
| memchr                       | 2.8.3            | Unlicense OR MIT                                    |
| mime                         | 0.3.17           | MIT OR Apache-2.0                                   |
| miniz_oxide                  | 0.8.9            | MIT OR Zlib OR Apache-2.0                           |
| mio                          | 1.2.2            | MIT                                                 |
| muda                         | 0.19.3           | Apache-2.0 OR MIT                                   |
| new_debug_unreachable        | 1.0.6            | MIT                                                 |
| num-conv                     | 0.2.2            | MIT OR Apache-2.0                                   |
| num-traits                   | 0.2.19           | MIT OR Apache-2.0                                   |
| objc2                        | 0.6.4            | MIT                                                 |
| objc2-app-kit                | 0.3.2            | Zlib OR Apache-2.0 OR MIT                           |
| objc2-core-foundation        | 0.3.2            | Zlib OR Apache-2.0 OR MIT                           |
| objc2-encode                 | 4.1.0            | MIT                                                 |
| objc2-exception-helper       | 0.1.1            | Zlib OR Apache-2.0 OR MIT                           |
| objc2-foundation             | 0.3.2            | MIT                                                 |
| objc2-web-kit                | 0.3.2            | Zlib OR Apache-2.0 OR MIT                           |
| once_cell                    | 1.21.4           | MIT OR Apache-2.0                                   |
| opaque-debug                 | 0.3.1            | MIT OR Apache-2.0                                   |
| option-ext                   | 0.2.0            | MPL-2.0                                             |
| parking_lot                  | 0.12.5           | MIT OR Apache-2.0                                   |
| parking_lot_core             | 0.9.12           | MIT OR Apache-2.0                                   |
| password-hash                | 0.5.0            | MIT OR Apache-2.0                                   |
| percent-encoding             | 2.3.2            | MIT OR Apache-2.0                                   |
| phf                          | 0.13.1           | MIT                                                 |
| phf_generator                | 0.13.1           | MIT                                                 |
| phf_macros                   | 0.13.1           | MIT                                                 |
| phf_shared                   | 0.13.1           | MIT                                                 |
| pin-project-lite             | 0.2.17           | Apache-2.0 OR MIT                                   |
| plist                        | 1.10.0           | MIT                                                 |
| png                          | 0.17.16          | MIT OR Apache-2.0                                   |
| png                          | 0.18.1           | MIT OR Apache-2.0                                   |
| polyval                      | 0.6.2            | Apache-2.0 OR MIT                                   |
| potential_utf                | 0.1.5            | Unicode-3.0                                         |
| powerfmt                     | 0.2.0            | MIT OR Apache-2.0                                   |
| precomputed-hash             | 0.1.1            | MIT                                                 |
| proc-macro2                  | 1.0.107          | MIT OR Apache-2.0                                   |
| quick-xml                    | 0.41.0           | MIT                                                 |
| quote                        | 1.0.47           | MIT OR Apache-2.0                                   |
| rand_core                    | 0.6.4            | MIT OR Apache-2.0                                   |
| raw-window-handle            | 0.6.2            | MIT OR Apache-2.0 OR Zlib                           |
| ref-cast                     | 1.0.26           | MIT OR Apache-2.0                                   |
| ref-cast-impl                | 1.0.26           | MIT OR Apache-2.0                                   |
| regex                        | 1.12.2           | MIT OR Apache-2.0                                   |
| regex-automata               | 0.4.18           | MIT OR Apache-2.0                                   |
| regex-syntax                 | 0.8.11           | MIT OR Apache-2.0                                   |
| rfd                          | 0.16.0           | MIT                                                 |
| rustc-hash                   | 2.1.3            | Apache-2.0 OR MIT                                   |
| rustix                       | 1.1.4            | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| ryu                          | 1.0.23           | Apache-2.0 OR BSL-1.0                               |
| same-file                    | 1.0.6            | Unlicense/MIT                                       |
| schemars                     | 0.8.22           | MIT                                                 |
| schemars                     | 0.9.0            | MIT                                                 |
| schemars                     | 1.2.2            | MIT                                                 |
| schemars_derive              | 0.8.22           | MIT                                                 |
| scopeguard                   | 1.2.0            | MIT OR Apache-2.0                                   |
| security-framework           | 3.7.0            | MIT OR Apache-2.0                                   |
| security-framework-sys       | 2.17.0           | MIT OR Apache-2.0                                   |
| selectors                    | 0.36.1           | MPL-2.0                                             |
| semver                       | 1.0.28           | MIT OR Apache-2.0                                   |
| serde                        | 1.0.228          | MIT OR Apache-2.0                                   |
| serde_core                   | 1.0.228          | MIT OR Apache-2.0                                   |
| serde_derive                 | 1.0.228          | MIT OR Apache-2.0                                   |
| serde_derive_internals       | 0.29.1           | MIT OR Apache-2.0                                   |
| serde_json                   | 1.0.145          | MIT OR Apache-2.0                                   |
| serde_repr                   | 0.1.21           | MIT OR Apache-2.0                                   |
| serde_spanned                | 1.1.1            | MIT OR Apache-2.0                                   |
| serde_with                   | 3.22.0           | MIT OR Apache-2.0                                   |
| serde_with_macros            | 3.22.0           | MIT OR Apache-2.0                                   |
| serde-untagged               | 0.1.9            | MIT OR Apache-2.0                                   |
| serialize-to-javascript      | 0.1.2            | MIT OR Apache-2.0                                   |
| serialize-to-javascript-impl | 0.1.2            | MIT OR Apache-2.0                                   |
| servo_arc                    | 0.4.3            | MIT OR Apache-2.0                                   |
| sha2                         | 0.10.9           | MIT OR Apache-2.0                                   |
| simd-adler32                 | 0.3.10           | MIT                                                 |
| siphasher                    | 1.0.3            | MIT/Apache-2.0                                      |
| smallvec                     | 1.15.2           | MIT OR Apache-2.0                                   |
| socket2                      | 0.6.5            | MIT OR Apache-2.0                                   |
| stable_deref_trait           | 1.2.1            | MIT OR Apache-2.0                                   |
| string_cache                 | 0.9.0            | MIT OR Apache-2.0                                   |
| strsim                       | 0.11.1           | MIT                                                 |
| subtle                       | 2.6.1            | BSD-3-Clause                                        |
| swift-rs                     | 1.0.7            | MIT OR Apache-2.0                                   |
| syn                          | 2.0.119          | MIT OR Apache-2.0                                   |
| syn                          | 3.0.3            | MIT OR Apache-2.0                                   |
| synstructure                 | 0.13.2           | MIT                                                 |
| tao                          | 0.35.3           | Apache-2.0                                          |
| tauri                        | 2.11.5           | Apache-2.0 OR MIT                                   |
| tauri-codegen                | 2.6.3            | Apache-2.0 OR MIT                                   |
| tauri-macros                 | 2.6.3            | Apache-2.0 OR MIT                                   |
| tauri-plugin-dialog          | 2.7.2            | Apache-2.0 OR MIT                                   |
| tauri-plugin-fs              | 2.5.1            | Apache-2.0 OR MIT                                   |
| tauri-plugin-single-instance | 2.4.3            | Apache-2.0 OR MIT                                   |
| tauri-runtime                | 2.11.3           | Apache-2.0 OR MIT                                   |
| tauri-runtime-wry            | 2.11.4           | Apache-2.0 OR MIT                                   |
| tauri-utils                  | 2.9.3            | Apache-2.0 OR MIT                                   |
| tendril                      | 0.5.1            | MIT OR Apache-2.0                                   |
| thiserror                    | 1.0.69           | MIT OR Apache-2.0                                   |
| thiserror                    | 2.0.17           | MIT OR Apache-2.0                                   |
| thiserror-impl               | 1.0.69           | MIT OR Apache-2.0                                   |
| thiserror-impl               | 2.0.17           | MIT OR Apache-2.0                                   |
| time                         | 0.3.55           | MIT OR Apache-2.0                                   |
| time-core                    | 0.1.9            | MIT OR Apache-2.0                                   |
| time-macros                  | 0.2.32           | MIT OR Apache-2.0                                   |
| tinystr                      | 0.8.3            | Unicode-3.0                                         |
| tinyvec                      | 1.12.0           | Zlib OR Apache-2.0 OR MIT                           |
| tinyvec_macros               | 0.1.1            | MIT OR Apache-2.0 OR Zlib                           |
| tokio                        | 1.53.1           | MIT                                                 |
| toml                         | 1.1.4+spec-1.1.0 | MIT OR Apache-2.0                                   |
| toml_datetime                | 1.1.1+spec-1.1.0 | MIT OR Apache-2.0                                   |
| toml_parser                  | 1.1.3+spec-1.1.0 | MIT OR Apache-2.0                                   |
| toml_writer                  | 1.1.2+spec-1.1.0 | MIT OR Apache-2.0                                   |
| tracing                      | 0.1.44           | MIT                                                 |
| tracing-attributes           | 0.1.31           | MIT                                                 |
| tracing-core                 | 0.1.36           | MIT                                                 |
| typeid                       | 1.0.3            | MIT OR Apache-2.0                                   |
| typenum                      | 1.20.1           | MIT OR Apache-2.0                                   |
| unic-char-property           | 0.9.0            | MIT/Apache-2.0                                      |
| unic-char-range              | 0.9.0            | MIT/Apache-2.0                                      |
| unic-common                  | 0.9.0            | MIT/Apache-2.0                                      |
| unic-ucd-ident               | 0.9.0            | MIT/Apache-2.0                                      |
| unic-ucd-version             | 0.9.0            | MIT/Apache-2.0                                      |
| unicode-ident                | 1.0.24           | (MIT OR Apache-2.0) AND Unicode-3.0                 |
| unicode-segmentation         | 1.13.3           | MIT OR Apache-2.0                                   |
| universal-hash               | 0.5.1            | MIT OR Apache-2.0                                   |
| url                          | 2.5.8            | MIT OR Apache-2.0                                   |
| urlpattern                   | 0.3.0            | MIT                                                 |
| utf8_iter                    | 1.0.4            | Apache-2.0 OR MIT                                   |
| uuid                         | 1.24.0           | Apache-2.0 OR MIT                                   |
| walkdir                      | 2.5.0            | Unlicense/MIT                                       |
| web_atoms                    | 0.2.6            | MIT OR Apache-2.0                                   |
| window-vibrancy              | 0.6.0            | Apache-2.0 OR MIT                                   |
| winnow                       | 1.0.4            | MIT                                                 |
| writeable                    | 0.6.3            | Unicode-3.0                                         |
| wry                          | 0.55.1           | Apache-2.0 OR MIT                                   |
| yoke                         | 0.8.3            | Unicode-3.0                                         |
| yoke-derive                  | 0.8.2            | Unicode-3.0                                         |
| zerofrom                     | 0.1.8            | Unicode-3.0                                         |
| zerofrom-derive              | 0.1.7            | Unicode-3.0                                         |
| zeroize                      | 1.8.1            | Apache-2.0 OR MIT                                   |
| zeroize_derive               | 1.5.0            | Apache-2.0 OR MIT                                   |
| zerotrie                     | 0.2.4            | Unicode-3.0                                         |
| zerovec                      | 0.11.6           | Unicode-3.0                                         |
| zerovec-derive               | 0.11.3           | Unicode-3.0                                         |
