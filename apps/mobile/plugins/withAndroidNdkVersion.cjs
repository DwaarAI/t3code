const { withProjectBuildGradle } = require("expo/config-plugins");

// React Native's prebuilt fbjni (0.7.0) is compiled with NDK r28c and calls
// libc++ symbols such as __cxa_init_primary_exception that NDK r27's
// libc++_shared.so lacks. Expo defaults to r27, so a release APK packaged with
// r27's runtime crashes on launch with "couldn't find DSO to load: libfbjni.so".
// Build every native module with the NDK fbjni was built with.
const NDK_VERSION = "28.2.13676358";
const ROOT_PLUGIN = 'apply plugin: "expo-root-project"';
const NDK_LINE = `ext.ndkVersion = "${NDK_VERSION}"`;

module.exports = function withAndroidNdkVersion(config) {
  return withProjectBuildGradle(config, (nextConfig) => {
    const gradle = nextConfig.modResults;
    if (gradle.language !== "groovy") {
      throw new Error("withAndroidNdkVersion expects a Groovy android/build.gradle.");
    }
    if (gradle.contents.includes(NDK_LINE)) return nextConfig;
    if (!gradle.contents.includes(ROOT_PLUGIN)) {
      throw new Error(
        `withAndroidNdkVersion could not find ${ROOT_PLUGIN} in android/build.gradle.`,
      );
    }
    // expo-root-project only fills in ndkVersion when it is unset, so set it first.
    gradle.contents = gradle.contents.replace(ROOT_PLUGIN, `${NDK_LINE}\n\n${ROOT_PLUGIN}`);
    return nextConfig;
  });
};
