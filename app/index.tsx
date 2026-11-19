import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Backdrop, Button, Logo, Text } from '@/components';

// Temporary landing screen. The real Welcome screen arrives with the
// "Screen shells and navigation" card.
export default function Index() {
  return (
    <View style={styles.container}>
      <Backdrop />
      <Logo />
      <Text variant="callout" color="text2">
        Different apps. One aux.
      </Text>
      <Link href="/dev/components" asChild>
        <Button kind="secondary" size="small" label="Component gallery" />
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
});
