# GitHub Secrets Setup Guide

This document explains how to configure the required GitHub secrets for the Android release workflow.

## Required Secrets

You need to add **2 secrets** to your GitHub repository:

### 1. `ANDROID_KEYSTORE_BASE64`

This is your `release.keystore` file encoded in base64 format.

**How to generate:**

```bash
# Navigate to your keystore location
cd /Users/joblesspoet/Desktop/antigravity-apps/SilentZone/android/app

# Encode the keystore file to base64
base64 -i release.keystore | pbcopy
```

The base64 string is now copied to your clipboard. Paste it as the secret value.

> [!IMPORTANT]
> Make sure you have the `release.keystore` file in `android/app/` directory. The workflow expects this file to exist.

---

### 2. `GOOGLE_MAPS_API_KEY`

Your Google Maps API key for Android.

**Current value (from local.properties):**
```
AIzaSyDo3lPNrrPTUcqD0vHnVMQ2hwIwwwuCjTg
```

> [!WARNING]
> Never commit this API key to your repository. Always use GitHub secrets.

---

## How to Add Secrets to GitHub

1. Go to your repository on GitHub
2. Click on **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add each secret with the exact name and value as specified above

---

## Signing Configuration

The workflow uses the signing configuration already defined in `android/gradle.properties`:

```properties
SILENT_ZONE_RELEASE_STORE_FILE=release.keystore
SILENT_ZONE_RELEASE_KEY_ALIAS=silent-zone-alias
SILENT_ZONE_RELEASE_STORE_PASSWORD=silentzonepass
SILENT_ZONE_RELEASE_KEY_PASSWORD=silentzonepass
```

> [!NOTE]
> These values are already committed to your repository in `gradle.properties`, so you don't need to add them as secrets. Only the keystore file itself and the Google Maps API key need to be secrets.

---

## Running the Workflow

1. Go to **Actions** tab in your GitHub repository
2. Select **Android Manual Release** from the workflows list
3. Click **Run workflow**
4. Choose build type:
   - **apk**: Generates an APK file (for direct installation or testing)
   - **bundle**: Generates an AAB file (for Google Play Store upload)
5. Click **Run workflow** button

The build artifacts will be available in the workflow run page after completion.
