const MODULE_ID = "blackguard-banknotes";
const BANKNOTE_IMAGE = `modules/${MODULE_ID}/assets/blackguard-banknote.webp`;
const COPPER_VALUES = Object.freeze({ pp: 1000, gp: 100, sp: 10, cp: 1 });
const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

function active() {
  return game.system.id === "pf2e" && game.settings.get(MODULE_ID, "enabled");
}

function showNativeValues() {
  return game.user.isGM && game.settings.get(MODULE_ID, "showNativeValues");
}

function nativeCurrencyString(currency) {
  return Object.entries(COPPER_VALUES)
    .filter(([denomination]) => Number(currency?.[denomination]) > 0)
    .map(([denomination]) => `${Number(currency[denomination])} ${denomination}`)
    .join(", ") || "0 cp";
}

function copperValue(currency) {
  return Object.entries(COPPER_VALUES).reduce(
    (total, [denomination, value]) => total + (Number(currency?.[denomination]) || 0) * value,
    0
  );
}

function formatBanknotes(value) {
  const notes = Math.round(Number(value) || 0);
  return `N${notes.toLocaleString()}`;
}

async function setBanknoteBalance(actor, value) {
  const banknotes = Math.max(0, Math.floor(Number(value) || 0));
  const current = actor.inventory.currency;
  const removed = await actor.inventory.removeCurrency(current, { byValue: false });
  if (!removed && copperValue(current) > 0) throw new Error(`Could not update ${actor.name}'s currency.`);
  if (banknotes > 0) await actor.inventory.addCurrency({ cp: banknotes }, { combineStacks: true });
}

async function editBanknoteBalance(actor) {
  const current = copperValue(actor.inventory.currency);
  const banknotes = await DialogV2.wait({
    window: { title: `Set Banknotes: ${actor.name}` },
    content: `<p><strong>N1 equals 1 cp.</strong> Enter the actor's total banknote value.</p>
      <div class="form-group"><label for="blackguard-banknotes-value">Banknotes</label><div class="form-fields"><span class="blackguard-banknote">N</span><input id="blackguard-banknotes-value" name="banknotes" type="number" min="0" step="1" value="${current}"></div></div>`,
    buttons: [
      { action: "save", default: true, icon: "fa-solid fa-floppy-disk", label: "Set Banknotes", callback: (_event, button) => Number(button.form.elements.banknotes.value) },
      { action: "cancel", icon: "fa-solid fa-xmark", label: "Cancel", callback: () => null }
    ]
  });
  if (banknotes === null || banknotes === undefined) return;
  await setBanknoteBalance(actor, banknotes);
  ui.notifications.info(`${actor.name}'s currency is now ${formatBanknotes(banknotes)}.`);
}

function createNote(value, native = null) {
  const note = document.createElement("span");
  note.className = "blackguard-banknote";
  note.textContent = String(Math.round(value || 0).toLocaleString());
  note.dataset.tooltip = native ? `${formatBanknotes(value)} (${native})` : formatBanknotes(value);
  return note;
}

function rootElement(html) {
  return html instanceof HTMLElement ? html : html?.[0] instanceof HTMLElement ? html[0] : null;
}

function shouldSkipTextNode(node) {
  const parent = node.parentElement;
  return !parent
    || parent.closest("script, style, code, pre, textarea, input, select, option, button, [data-blackguard-banknote]")
    || parent.closest(".coinage");
}

function replaceCurrencyText(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const matcher = /(\d[\d,]*(?:\.\d+)?)\s*(pp|gp|sp|cp)\b/gi;

  for (const node of nodes) {
    if (shouldSkipTextNode(node) || !matcher.test(node.textContent)) continue;
    matcher.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    for (const match of node.textContent.matchAll(matcher)) {
      const [whole, rawAmount, denomination] = match;
      const amount = Number(rawAmount.replaceAll(",", ""));
      if (!Number.isFinite(amount)) continue;
      fragment.append(node.textContent.slice(lastIndex, match.index));
      const native = `${rawAmount} ${denomination.toLowerCase()}`;
      fragment.append(createNote(amount * COPPER_VALUES[denomination.toLowerCase()], native));
      lastIndex = (match.index ?? 0) + whole.length;
    }
    fragment.append(node.textContent.slice(lastIndex));
    node.replaceWith(fragment);
  }
}

function parseNativeCurrency(value) {
  const match = String(value ?? "").trim().match(/^(\d[\d,]*(?:\.\d+)?)\s*(pp|gp|sp|cp)$/i);
  if (!match) return null;
  const amount = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(amount) ? amount * COPPER_VALUES[match[2].toLowerCase()] : null;
}

function parseBanknoteValue(value) {
  const match = String(value ?? "").trim().match(/^N?\s*(\d[\d,]*)$/i);
  return match ? Number(match[1].replaceAll(",", "")) : null;
}

function decoratePriceInputs(root) {
  for (const input of root.querySelectorAll("input[data-property='system.price.value']")) {
    const value = parseNativeCurrency(input.value);
    if (value === null) continue;
    input.value = formatBanknotes(value);
    input.dataset.blackguardBanknote = "true";
    input.title = "Enter a banknote value, such as N400. N1 equals 1 cp.";
  }
}

function normalizeBanknotePriceInput(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.dataset.property !== "system.price.value") return;
  const value = parseBanknoteValue(input.value);
  if (value !== null) input.value = `${value} cp`;
}

function currencyItems(actor) {
  return actor?.items?.filter((entry) => entry.type === "treasure" && entry.system.category === "coin") ?? [];
}

function hideCurrencyRows(root, actor) {
  if (!actor?.items) return;
  for (const item of currencyItems(actor)) {
    root.querySelector(`[data-item-id="${item.id}"]`)?.setAttribute("hidden", "");
  }
}

function replaceTreasureCoinage(root, actor) {
  const items = currencyItems(actor);
  if (!items.length) return;

  const primary = items.find((item) => item.system.price.value.cp === 1) ?? items[0];
  const row = root.querySelector(`[data-item-id="${primary.id}"]`);
  if (!row) return;

  const amount = copperValue(actor.inventory.currency);
  row.removeAttribute("hidden");
  row.classList.add("blackguard-banknotes-treasure-row");
  row.dataset.tooltip = `${formatBanknotes(amount)}. N1 equals 1 cp.`;
  if (row.dataset.blackguardBanknoteValue === String(amount)) return;
  row.dataset.blackguardBanknoteValue = String(amount);

  const image = row.querySelector("img.item-icon, .item-image img");
  if (image) {
    image.src = BANKNOTE_IMAGE;
    image.alt = "Banknotes";
  }

  const name = row.querySelector(".item-name a, .item-name h4, h4.item-name, .item-name, h4 a");
  if (name) name.textContent = "Banknotes";

  const price = row.querySelector(".price");
  if (price) {
    price.textContent = "";
    price.append(createNote(1, "1 cp"));
  }
}

function removeToolbeltMergeControl(root) {
  for (const control of root.querySelectorAll("button[data-tooltip='pf2e-toolbelt.betterInventory.sheet.merge']")) {
    const container = control.closest("li");
    if (container) container.remove();
    else control.remove();
  }
}

function replaceCoinage(root, actor) {
  const coinage = root.querySelector(".coinage");
  const currency = actor?.inventory?.currency;
  if (!coinage || !currency) return;
  const amount = copperValue(currency);
  const original = nativeCurrencyString(currency);
  const denominations = coinage.querySelector(".currency");
  if (denominations) {
    denominations.replaceChildren();
    const entry = document.createElement("li");
    entry.className = "denomination banknotes";
    entry.dataset.blackguardBanknote = "true";
    const image = document.createElement("div");
    image.className = "currency-image";
    image.dataset.tooltip = showNativeValues() ? `${formatBanknotes(amount)} (${original})` : formatBanknotes(amount);
    const banknoteImage = document.createElement("img");
    banknoteImage.src = BANKNOTE_IMAGE;
    banknoteImage.alt = "Banknotes";
    image.append(banknoteImage);
    const text = document.createElement("span");
    text.textContent = amount.toLocaleString();
    entry.append(image, text);
    if (showNativeValues()) {
      const debug = document.createElement("span");
      debug.className = "blackguard-native-value";
      debug.textContent = `(${original})`;
      entry.append(debug);
    }
    denominations.append(entry);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "blackguard-banknote-edit";
    edit.innerHTML = '<i class="fa-solid fa-money-bill-transfer"></i>';
    edit.dataset.tooltip = "Set Banknote Balance";
    edit.addEventListener("click", () => editBanknoteBalance(actor).catch((error) => {
      console.error(`${MODULE_ID} | could not update banknotes`, error);
      ui.notifications.error(`Could not update ${actor.name}'s banknotes. See the console for details.`);
    }));
    denominations.append(edit);
  }

  for (const total of coinage.querySelectorAll(".wealth .item-name > span")) {
    if (total.dataset.blackguardBanknote) continue;
    const raw = total.textContent.trim();
    const match = raw.match(/([\d,.]+)\s*(pp|gp|sp|cp)\b/i);
    if (!match) continue;
    const numeric = Number(match[1].replaceAll(",", "")) * COPPER_VALUES[match[2].toLowerCase()];
    total.textContent = "";
    total.append(createNote(numeric, raw));
    total.dataset.blackguardBanknote = "true";
  }

  hideCurrencyRows(root, actor);
  replaceTreasureCoinage(root, actor);
  removeToolbeltMergeControl(root);
}

function decorateApplication(app, html) {
  if (!active()) return;
  const root = rootElement(html);
  if (!root || root.dataset.blackguardBanknotesDecorated === "true") return;
  root.dataset.blackguardBanknotesDecorated = "true";
  replaceCoinage(root, app?.actor);
  replaceCurrencyText(root);
  decoratePriceInputs(root);
  const refreshCurrencyUI = () => {
    hideCurrencyRows(root, app?.actor);
    replaceTreasureCoinage(root, app?.actor);
    removeToolbeltMergeControl(root);
    // Expanded inventory entries are inserted after the sheet's initial render.
    // Re-run the presentation pass so their price text and price inputs use N values.
    replaceCurrencyText(root);
    decoratePriceInputs(root);
  };
  setTimeout(refreshCurrencyUI, 0);
  const observer = new MutationObserver(refreshCurrencyUI);
  observer.observe(root, { childList: true, subtree: true });
  root.addEventListener("click", (event) => {
    if (event.target.closest("[data-tab='inventory']")) setTimeout(refreshCurrencyUI, 0);
  });
  root.addEventListener("change", normalizeBanknotePriceInput, true);
  root.addEventListener("submit", (event) => {
    for (const input of event.currentTarget.querySelectorAll("input[data-property='system.price.value']")) normalizeBanknotePriceInput({ target: input });
  }, true);
}

function migrationCandidates() {
  return game.actors.contents
    .filter((actor) => actor.isOwner && actor.inventory?.currency)
    .map((actor) => ({ actor, currency: actor.inventory.currency }))
    .filter(({ currency }) => copperValue(currency) > 0);
}

class BanknoteMigrationApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["blackguard-banknote-migration"],
    id: "blackguard-banknote-migration",
    tag: "form",
    window: { title: "Migrate Currency to Blackguard Banknotes", resizable: true },
    position: { width: 700, height: "auto" },
    actions: { migrate: BanknoteMigrationApp.#migrate }
  };

  static PARTS = {
    migration: {
      template: `modules/${MODULE_ID}/templates/migration.hbs`,
      root: true
    }
  };

  async _prepareContext() {
    return {
      candidates: migrationCandidates().map(({ actor, currency }) => ({
        id: actor.id,
        name: actor.name,
        native: nativeCurrencyString(currency),
        banknotes: formatBanknotes(copperValue(currency))
      }))
    };
  }

  static async #migrate() {
    const candidates = migrationCandidates();
    if (!candidates.length) return ui.notifications.info("There are no actor balances to migrate.");
    const confirmed = await DialogV2.confirm({
      window: { title: "Confirm Banknote Migration" },
      content: `<p>Convert ${candidates.length} actor balance${candidates.length === 1 ? "" : "s"} to copper-value banknotes? This preserves every value, while replacing pp, gp, and sp amounts with cp.</p>`,
      yes: { label: "Migrate Balances", icon: "fa-solid fa-money-bill-transfer" },
      no: { label: "Cancel" }
    });
    if (!confirmed) return;

    for (const { actor, currency } of candidates) {
      await setBanknoteBalance(actor, copperValue(currency));
    }
    ui.notifications.info(`Migrated ${candidates.length} actor balance${candidates.length === 1 ? "" : "s"} to Blackguard banknotes.`);
    this.close();
  }
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "enabled", {
    name: "Use Blackguard Banknotes",
    hint: "Render PF2e currency as copper-value banknotes: N1 equals 1 cp and N100 equals 1 gp.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    restricted: true,
    onChange: () => window.location.reload()
  });
  game.settings.register(MODULE_ID, "showNativeValues", {
    name: "Show Native Currency Values to GMs",
    hint: "Show the underlying pp/gp/sp/cp value beside each banknote balance for GM verification.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    restricted: true,
    onChange: () => window.location.reload()
  });
  game.settings.registerMenu(MODULE_ID, "migrateBalances", {
    name: "Migrate Existing Balances",
    hint: "Preview and convert owned actor coin balances into copper-value banknotes.",
    icon: "fa-solid fa-money-bill-transfer",
    type: BanknoteMigrationApp,
    restricted: true
  });
});

Hooks.on("renderActorSheet", decorateApplication);
Hooks.on("renderItemSheet", decorateApplication);
Hooks.on("renderChatMessageHTML", (_message, html) => decorateApplication(null, html));
