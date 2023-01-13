#!/usr/bin/env node
"use strict";

const { chromium } = require("playwright");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const createPrompt = require("prompt-sync");

const argv = yargs(hideBin(process.argv)).argv;

if (!argv.seller) {
  throw new Error("seller missing");
}

const PRICECHARTING_URL = `https://www.pricecharting.com/offers?seller=${argv.seller}&status=collection`;
const BACKLOGGERY_URL = "https://www.backloggery.com";

// Matches Backloggery region select
const Region = {
  NA: 0,
  Japan: 1,
  PAL: 2,
  China: 3,
  Korea: 4,
  Brazil: 5,
};

const PRICECHARTING_TO_BACKLOGGERY_CONSOLE_MAP = {
  Amiibo: undefined,
  "Asian English Switch": { name: "Switch", region: Region.Korea },
  "Game &amp; Watch": { name: "GW", region: Region.NA },
  GameBoy: { name: "GB", region: Region.NA },
  "GameBoy Advance": { name: "GBA", region: Region.NA },
  "GameBoy Color": { name: "GBC", region: Region.NA },
  Gamecube: { name: "GCN", region: Region.NA },
  "JP Nintendo Switch": { name: "Switch", region: Region.Japan },
  "JP PC Engine": { name: "TG16", region: Region.Japan },
  "JP PC Engine CD": { name: "TGCD", region: Region.Japan },
  NES: { name: "NES", region: Region.NA },
  "Nintendo 3DS": { name: "3DS", region: Region.NA },
  "Nintendo 64": { name: "N64", region: Region.NA },
  "Nintendo DS": { name: "NDS", region: Region.NA },
  "Nintendo Switch": { name: "Switch", region: Region.NA },
  "PAL Nintendo Switch": { name: "Switch", region: Region.PAL },
  "PAL Playstation 4": { name: "PS4", region: Region.PAL },
  "PAL Xbox 360": { name: "360", region: Region.PAL },
  "PC Games": { name: "Steam", region: Region.NA },
  PSP: { name: "PSP", region: Region.NA },
  Playstation: { name: "PS", region: Region.NA },
  "Playstation 2": { name: "PS2", region: Region.NA },
  "Playstation 3": { name: "PS3", region: Region.NA },
  "Playstation 4": { name: "PS4", region: Region.NA },
  "Playstation 5": { name: "PS5", region: Region.NA },
  "Playstation Vita": { name: "PSVita", region: Region.NA },
  "Sega CD": { name: "SCD", region: Region.NA },
  "Sega Dreamcast": { name: "DC", region: Region.NA },
  "Sega Game Gear": { name: "GG", region: Region.NA },
  "Sega Genesis": { name: "GEN", region: Region.NA },
  "Super Famicom": { name: "NES", region: Region.Japan },
  "Super Nintendo": { name: "SNES", region: Region.NA },
  "TurboGrafx-16": { name: "TG16", region: Region.NA },
  Wii: { name: "Wii", region: Region.NA },
  "Wii U": { name: "WiiU", region: Region.NA },
  Xbox: { name: "Xbox", region: Region.NA },
  "Xbox One": { name: "XBO", region: Region.NA },
};

async function getAllOffers() {
  const res = await fetch(PRICECHARTING_URL, {
    headers: {
      accept: "application/json",
    },
  });

  const json = await res.json();

  let { cursor, offers } = json;

  while (cursor) {
    const nextRes = await fetch(`${PRICECHARTING_URL}&cursor=${cursor}`, {
      headers: {
        accept: "application/json",
      },
    });

    const nextJson = await nextRes.json();

    cursor = nextJson.cursor;
    offers = offers.concat(nextJson.offers);
  }

  return offers;
}

function getPricechartingGames(offers) {
  const games = [];

  offers.forEach((offer) => {
    const gameName = offer["product-name"];
    const console = offer["console-name"];
    const blConsole = PRICECHARTING_TO_BACKLOGGERY_CONSOLE_MAP[console];

    // If no matching console in BL, skip it
    if (!blConsole) {
      return;
    }

    const game = {
      name: gameName,
      region: blConsole.region,
      console: blConsole.name,
    };
    games.push(game);
  });

  return games;
}

async function loginToBackloggery(page, username, password) {
  await page.goto(`${BACKLOGGERY_URL}/login.php`);
  await page.getByRole("textbox", { name: "username" }).fill(username);
  await page.getByRole("textbox", { name: "password" }).fill(password);
  await page.getByRole("button", { name: "Submit" }).click();
  try {
    await page.waitForFunction(
      (loginUrl) => window.location.href !== loginUrl,
      `${BACKLOGGERY_URL}/login.php`,
      { timeout: 5000 }
    );
  } catch {
    page.close();
    throw new Error("Login failed!");
  }
}

async function getBackloggeryGames(page, username) {
  await page.goto(
    `${BACKLOGGERY_URL}/ajax_moregames.php?user=${username}&console=&rating=&status=&unplayed=&own=&search=&comments=&region=&region_u=0&wish=&alpha=&temp_sys=ZZZ&total=2&aid=1&ajid=0`
  );

  const gameEls = await page.locator("section.gamebox:not(.systemend)").all();
  const gamesByConsole = {};
  for (let i = 0; i < gameEls.length; i++) {
    const gameEl = gameEls[i];
    const game = (await gameEl.locator("h2 > b").textContent()).trim();
    const console = (await gameEl.locator(".gamerow > b").textContent()).trim();
    if (!gamesByConsole[console]) {
      gamesByConsole[console] = [game];
    } else {
      gamesByConsole[console].push(game);
    }
  }

  return gamesByConsole;
}

function getGamesToAdd(pricechartingGames, backloggeryGames) {
  const gamesToAdd = pricechartingGames
    .map((game) => {
      if (
        backloggeryGames[game.console]?.some((blGame) => game.name === blGame)
      ) {
        return null;
      }
      return game;
    })
    .filter((game) => game !== null);

  return gamesToAdd;
}

async function addGames(page, gamesToAdd, username) {
  await page.goto(`${BACKLOGGERY_URL}/newgame.php?user=${username}`);
  await page.getByRole("button", { name: "Toggle" }).click();

  for (let i = 0; i < gamesToAdd.length; i++) {
    const game = gamesToAdd[i];

    await page.locator('input[name="name"]').fill(game.name);
    await page.locator('select[name="console"]').selectOption(game.console);
    await page.locator('select[name="region"]').selectOption(`${game.region}`);
    await page.getByRole("button", { name: "Stealth Add" }).click();

    await page.waitForTimeout(1000);
  }
}

async function run() {
  const prompt = createPrompt({});
  const username = prompt("Backloggery Username: ");
  const password = prompt.hide("Backloggery Password: ");

  // Fetch all games from pricecharting
  const offers = await getAllOffers();
  const pricechartingGames = getPricechartingGames(offers);

  // Fetch games from backloggery
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await loginToBackloggery(page, username, password);
  const backloggeryGames = await getBackloggeryGames(page, username);

  // Games to add are those in pricecharting but missing from backloggery
  const gamesToAdd = getGamesToAdd(pricechartingGames, backloggeryGames);
  if (gamesToAdd.length > 0) {
    await addGames(page, gamesToAdd, username);
    console.log(`${gamesToAdd.length} games added`);
  } else {
    console.log("No games to add");
  }

  await browser.close();
}

run();
