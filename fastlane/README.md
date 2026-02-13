fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## Android

### android build

```sh
[bundle exec] fastlane android build
```

Build the AAB

### android build_apk

```sh
[bundle exec] fastlane android build_apk
```

Build production APK

### android build_debug

```sh
[bundle exec] fastlane android build_debug
```

Build debug APK

### android install_debug

```sh
[bundle exec] fastlane android install_debug
```

Build and install debug APK on emulator

### android install_emulator

```sh
[bundle exec] fastlane android install_emulator
```

Build and install APK on emulator

### android deploy

```sh
[bundle exec] fastlane android deploy
```

Deploy to Internal Testing

### android beta

```sh
[bundle exec] fastlane android beta
```

Alias for deploy

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
