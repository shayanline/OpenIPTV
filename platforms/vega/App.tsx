import { WebView } from "@amazon-devices/webview";
import { useEffect, useState } from "react";
import { BackHandler, StyleSheet, View } from "react-native";

/**
 * Copy into an official Vega WebView template. The UI remains the shared Vite build.
 * The SDK project owns registration, dependency versions and the final VPKG manifest.
 */
export const App = () => {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (closed) BackHandler.exitApp();
  }, [closed]);
  return (
    <View style={styles.container}>
      {!closed && (
        <WebView
          style={styles.container}
          source={{ uri: "file:///pkg/assets/openiptv/index.html" }}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          hasTVPreferredFocus={true}
          mediaPlaybackRequiresUserAction={false}
          allowSystemKeyEvents={true}
          onCloseWindow={() => setClosed(true)}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({ container: { flex: 1 } });
