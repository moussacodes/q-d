import { Fragment } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Chip, Panel, SegmentedControl, Text } from '@/components';
import { useTheme } from '@/design';
import {
  allows,
  ruleNames,
  setAudience,
  type Audience,
  type RoomRule,
  type RoomRules,
  type RuleMember,
  type RuleName,
} from '@/domain/room-rules';

const ruleLabels: Record<RuleName, string> = {
  addSongs: 'Add songs',
  control: 'Play, skip, reorder, remove',
};

/** The host's choices. "Only you" because only the host sees them. */
const choices: readonly { value: Audience; label: string }[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'chosen', label: 'Chosen' },
  { value: 'host', label: 'Only you' },
];

/** How a rule reads to someone who isn't the host. */
const audienceForListeners: Record<Audience, string> = {
  everyone: 'Everyone',
  chosen: 'Chosen people',
  host: 'Host only',
};

/** Under a disabled Add a song button: why you can't add. */
export function cantAddNote(rule: RoomRule) {
  return rule.who === 'chosen'
    ? 'Only people the host chose can add songs.'
    : 'Only the host adds songs in this room.';
}

/**
 * The host's room rules (Start a room, Listeners): each rule offers Everyone,
 * Chosen people or Only you. `chosenHint` says where the chosen people are
 * picked, and shows once any rule is set to Chosen.
 */
export function RoomRulesEditor({
  rules,
  onChange,
  chosenHint,
}: {
  rules: RoomRules;
  onChange: (rules: RoomRules) => void;
  chosenHint: string;
}) {
  const { colors } = useTheme();
  const anyChosen = ruleNames.some((name) => rules[name].who === 'chosen');
  return (
    <Panel>
      {ruleNames.map((name, index) => (
        <Fragment key={name}>
          {index > 0 ? <View style={[styles.divider, { backgroundColor: colors.stroke }]} /> : null}
          <View style={styles.rule}>
            <Text variant="label">{ruleLabels[name]}</Text>
            <SegmentedControl
              fill
              options={choices}
              value={rules[name].who}
              onChange={(who) => onChange(setAudience(rules, name, who))}
            />
          </View>
        </Fragment>
      ))}
      {anyChosen ? (
        <Text variant="caption" color="text2">
          {chosenHint}
        </Text>
      ) : null}
    </Panel>
  );
}

/** The rules as text, for someone who isn't the host. */
export function RoomRulesSummary({ rules, you }: { rules: RoomRules; you?: RuleMember }) {
  const { colors } = useTheme();
  return (
    <>
      {ruleNames.map((name, index) => {
        const rule = rules[name];
        const included = rule.who === 'chosen' && allows(rule, you);
        return (
          <Fragment key={name}>
            {index > 0 ? (
              <View style={[styles.divider, { backgroundColor: colors.stroke }]} />
            ) : null}
            <View style={styles.row}>
              <Text variant="label" style={styles.flex}>
                {ruleLabels[name]}
              </Text>
              <Text variant="label" color="text2">
                {audienceForListeners[rule.who]}
                {included ? ' (incl. you)' : ''}
              </Text>
            </View>
          </Fragment>
        );
      })}
    </>
  );
}

const chipLabels: Record<RuleName, string> = {
  addSongs: 'Adds songs',
  control: 'Controls',
};

const chipActions: Record<RuleName, string> = {
  addSongs: 'add songs',
  control: 'play, skip, reorder and remove',
};

/**
 * In Listeners, the host's picks for each rule set to Chosen: one chip per
 * rule, on for the people chosen.
 */
export function ChosenChips({
  rules,
  person,
  onToggle,
}: {
  rules: RoomRules;
  person: { id: string; name: string };
  onToggle: (name: RuleName) => void;
}) {
  const chosenRules = ruleNames.filter((name) => rules[name].who === 'chosen');
  return (
    <View style={styles.chips}>
      {chosenRules.map((name) => {
        const on = rules[name].chosen.includes(person.id);
        return (
          <Pressable
            key={name}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${person.name} can ${chipActions[name]}`}
            hitSlop={6}
            onPress={() => onToggle(name)}
          >
            <Chip
              label={chipLabels[name]}
              tone={on ? 'accent' : 'neutral'}
              icon={on ? 'check' : 'plus'}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rule: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  divider: { height: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 },
});
