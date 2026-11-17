import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
const base = (
  process.env.DICECLOUD_TEST_URL || "http://127.0.0.1:31080"
).replace(/\/?$/, "/");
const url = (path) => new URL(path.replace(/^\//, ""), base).href;
const fixturePath = process.env.DICECLOUD_TEST_FIXTURE;
async function call(page, name, arg) {
  return page.evaluate(({ name, arg }) => window.Meteor.callAsync(name, arg), {
    name,
    arg,
  });
}
async function login(page, owner) {
  await page.goto(url("sign-in"));
  await page.getByLabel("Username or email").fill(owner.username);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.waitForFunction(() => !!window.Meteor.userId());
}
async function stat(page, id, key, total) {
  await page.waitForFunction(
    ({ id, key, total }) =>
      window.Mongo.getCollection("creatureProperties").findOne({
        "root.id": id,
        variableName: key,
      })?.total === total,
    { id, key, total },
  );
}
test("Native advancement workflow: paladin 10→11, preview, usage, reload and undo", async ({
  page,
}, info) => {
  test.skip(!fixturePath || !!process.env.DICECLOUD_VERIFY_RESTORE);
  test.setTimeout(180000);
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  await login(page, fixture.owner);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const id = await call(page, "creatures.insertCreature", {
    name: "Fictional level-up paladin",
    startingLevel: 10,
    allowedLibraries: [],
    allowedLibraryCollections: [],
  });
  const root = { collection: "creatures", id };
  const add = async (p) => {
    await page.waitForTimeout(1050);
    return call(page, "creatureProperties.insert", {
      creatureProperty: { ...p, root },
    });
  };
  const attr = (
    name,
    variableName,
    total,
    attributeType = "stat",
    extra = {},
  ) =>
    add({
      type: "attribute",
      name,
      variableName,
      attributeType,
      baseValue: { calculation: String(total) },
      ...extra,
    });
  for (const [name, value] of Object.entries({
    strength: 18,
    dexterity: 12,
    constitution: 16,
    intelligence: 10,
    wisdom: 14,
    charisma: 18,
  }))
    await attr(name, name, value, "ability");
  await attr("Level", "level", 10);
  await attr("Maximum HP", "hitPoints", 100, "healthBar", {
    damage: 12,
    reset: "longRest",
  });
  await attr("Proficiency", "proficiencyBonus", 4, "modifier");
  await attr("Armor", "armor", 18);
  await attr("Initiative", "initiative", 1, "modifier");
  await attr("Speed", "speed", 30);
  await attr("Hit dice", "dice", 10, "hitDice", {
    hitDiceSize: "d10",
    damage: 2,
    reset: "longRest",
  });
  for (const [i, n] of [4, 3, 2].entries())
    await attr(`Level ${i + 1} slots`, "slot" + i, n, "spellSlot", {
      spellSlotLevel: { calculation: String(i + 1) },
      reset: "longRest",
      damage: i === 2 ? 1 : 0,
    });
  await add({
    type: "skill",
    name: "wisdom save",
    variableName: "wisdomSave",
    skillType: "save",
    baseValue: { calculation: "10" },
  });
  await add({
    type: "skill",
    name: "athletics",
    variableName: "athletics",
    skillType: "skill",
    baseValue: { calculation: "8" },
  });
  await add({
    type: "spellList",
    name: "Paladin",
    dc: { calculation: "16" },
    attackRollBonus: { calculation: "8" },
  });
  await add({
    type: "note",
    name: "Personal note",
    description: { text: "Preserve my current story." },
  });
  await page.goto(url("character/" + id));
  await stat(page, id, "hitPoints", 100);
  await page.locator('[data-id="creature-menu"]').click();
  await page.getByText("Level up", { exact: true }).click();
  const dialog = page.getByRole("dialog").filter({
    has: page.getByText("Level up your character", { exact: true }),
  });
  await expect(
    dialog.getByRole("heading", { name: "Level 10 → 11" }),
  ).toBeVisible();
  await dialog
    .getByLabel("Subclass (any published or custom option)")
    .fill("A fictional custom oath");
  await dialog
    .getByLabel(
      "I reviewed the current proficiencies, level choices and resource usage with my rules or DM.",
    )
    .check();
  await dialog
    .getByRole("button", { name: "Preview level-up", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Review level 10 → 11" }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Improved Divine Smite", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText(/Maximum HP: 100 → 109/)).toBeVisible();
  await stat(page, id, "hitPoints", 100);
  await page.screenshot({
    path: info.outputPath("level-up-preview-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath("level-up-preview-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await dialog
    .getByRole("button", { name: "Apply level 11", exact: true })
    .click();
  await expect(
    dialog.getByText(
      "Level 11 applied. Your character and campaign links are preserved.",
    ),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await stat(page, id, "hitPoints", 109);
  await stat(page, id, "slot2", 3);
  const values = await page.evaluate((id) => {
    const p = window.Mongo.getCollection("creatureProperties");
    return {
      hpDamage: p.findOne({ "root.id": id, variableName: "hitPoints" }).damage,
      usedSlots: p.findOne({ "root.id": id, variableName: "slot2" }).damage,
      note: p.findOne({ "root.id": id, name: "Personal note" }).description
        .text,
    };
  }, id);
  expect(values).toEqual({
    hpDamage: 12,
    usedSlots: 1,
    note: "Preserve my current story.",
  });
  await page.getByRole("tab", { name: "Features", exact: true }).click();
  await expect(
    page.getByText("Improved Divine Smite", { exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByText("Improved Divine Smite", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await stat(page, id, "level", 11);
  await page.locator('[data-id="creature-menu"]').click();
  await page.getByText("Level up", { exact: true }).click();
  await dialog
    .getByRole("button", { name: "Undo latest level-up", exact: true })
    .waitFor();
  page.once("dialog", (d) => d.accept());
  await dialog
    .getByRole("button", { name: "Undo latest level-up", exact: true })
    .click();
  await expect(dialog.getByText("Latest level-up undone.")).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await stat(page, id, "hitPoints", 100);
  await stat(page, id, "level", 10);
  // Leave a real advancement layer in the synthetic fixture for restart/restore.
  const context = await call(page, "advancement.context", { creatureId: id });
  const p = await call(page, "advancement.preview", {
    creatureId: id,
    choices: {
      hpMode: "average",
      reviewed: true,
      spells: [],
      choices: "Verified with DM.",
    },
  });
  await call(page, "advancement.commit", {
    previewId: p.previewId,
    confirmed: true,
  });
  await stat(page, id, "level", 11);
  const archiveId = await call(
    page,
    "Creatures.methods.archiveCreatureToFile",
    { creatureId: id },
  );
  await page.goto(url("my-files"));
  const archived = page.locator(`[data-id="${archiveId}-archive-card"]`);
  await archived.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(archived).toHaveCount(0);
  await page.goto(url("character/" + id));
  await stat(page, id, "level", 11);
  await stat(page, id, "hitPoints", 109);
  await stat(page, id, "slot2", 3);
  fixture.advancement = { creatureId: id };
  writeFileSync(fixturePath, JSON.stringify(fixture), { mode: 0o600 });
  expect(errors).toEqual([]);
});
test("Native advancement retained after restart, backup and restore", async ({
  page,
}) => {
  test.skip(!fixturePath || !process.env.DICECLOUD_VERIFY_RESTORE);
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  expect(fixture.advancement?.creatureId).toBeTruthy();
  await login(page, fixture.owner);
  await page.goto(url("character/" + fixture.advancement.creatureId));
  await stat(page, fixture.advancement.creatureId, "level", 11);
  await stat(page, fixture.advancement.creatureId, "hitPoints", 109);
  await stat(page, fixture.advancement.creatureId, "slot2", 3);
});
