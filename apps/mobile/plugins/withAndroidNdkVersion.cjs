const { withProjectBuildGradle } = require("expo/config-plugins");

// React Native's prebuilt fbjni is built with NDK r28c and needs libc++ symbols
// r27 lacks. Expo defaults to r27, so release APKs crash on launch with
// "couldn't find DSO to load: libfbjni.so". Build everything with r28.
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
