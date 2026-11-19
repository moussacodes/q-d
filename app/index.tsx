import { StyleSheet, Text, View } from 'react-native';

// Temporary landing screen for the bootstrap. The real Welcome screen
// arrives with the "Screen shells and navigation" card.
export default function Index() {
  return (
    <View style={styles.container}>
      <Text style={styles.logo}>q’d</Text>
      <Text style={styles.caption}>Different apps. One aux.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
    gap: 8,
  },
  logo: {
    color: '#f5f1eb',
    fontSize: 22,
    fontWeight: '700',
  },
  caption: {
    color: 'rgba(245, 241, 235, 0.66)',
    fontSize: 15,
  },
});
