import { Meteor } from 'meteor/meteor';
import { getUserTier } from '/imports/api/users/patreon/tiers';
import Creatures from '/imports/api/creature/creatures/Creatures';

export function characterSlotsRemaining() {
  const userId = Meteor.userId();
  if (!userId) return 0;
  const tier = getUserTier(userId);
  if (tier.characterSlots === -1) return Number.POSITIVE_INFINITY;
  return tier.characterSlots - Creatures.find({ owner: userId }).count();
}
