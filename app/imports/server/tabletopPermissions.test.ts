import { assert } from 'chai';
import {
  assertCanEditTabletop, assertUserGameMasterOfTabletop, assertUserIsTabletopOwner,
} from '/imports/api/tabletop/methods/shared/tabletopPermissions';

describe('Tabletop permission migration', function () {
  const tabletop = { owner: 'owner', gameMasters: ['gm'], players: ['player'], spectators: ['viewer'] };
  it('permits owners and game masters to edit while denying players and outsiders', function () {
    for (const user of ['owner', 'gm']) assert.doesNotThrow(() => assertCanEditTabletop(tabletop as any, user));
    for (const user of ['player', 'viewer', 'other']) assert.throws(() => assertCanEditTabletop(tabletop as any, user));
  });
  it('requires the actual game-master role and ownership for restricted operations', function () {
    assert.doesNotThrow(() => assertUserGameMasterOfTabletop(tabletop as any, 'gm'));
    assert.throws(() => assertUserGameMasterOfTabletop(tabletop as any, 'player'));
    assert.doesNotThrow(() => assertUserIsTabletopOwner(tabletop as any, 'owner'));
    assert.throws(() => assertUserIsTabletopOwner(tabletop as any, 'gm'));
  });
});
