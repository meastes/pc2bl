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
const BACKLOGGERY_URL = "https://backloggery.com";

// Matches Backloggery region select
const Region = {
  Free: 1,
  NA: 2,
  Japan: 3,
  PAL: 4,
  China: 5,
  Korea: 6,
  Brazil: 7,
  Asia: 8,
};

const PRICECHARTING_TO_BACKLOGGERY_CONSOLE_MAP = {
  Amiibo: undefined,
  "Asian English Switch": { name: "Nintendo Switch", region: Region.Korea },
  "Game &amp; Watch": { name: "Miscellaneous", region: Region.NA },
  GameBoy: { name: "Game Boy", region: Region.NA },
  "GameBoy Advance": { name: "Game Boy Advance", region: Region.NA },
  "GameBoy Color": { name: "Game Boy Color", region: Region.NA },
  Gamecube: { name: "Nintendo GameCube", region: Region.NA },
  "JP Nintendo DS": { name: "Nintendo DS", region: Region.Japan },
  "JP Nintendo Switch": { name: "Nintendo Switch", region: Region.Japan },
  "JP PC Engine": { name: "TurboGrafx-16", region: Region.Japan },
  "JP PC Engine CD": { name: "TurboGrafx-CD", region: Region.Japan },
  "JP Super CD-Rom": { name: "TurboGrafx-CD", region: Region.Japan },
  NES: { name: "Nintendo Entertainment System", region: Region.NA },
  "Nintendo 3DS": { name: "Nintendo 3DS", region: Region.NA },
  "Nintendo 64": { name: "Nintendo 64", region: Region.NA },
  "Nintendo DS": { name: "Nintendo DS", region: Region.NA },
  "Nintendo Switch": { name: "Nintendo Switch", region: Region.NA },
  "PAL Nintendo Switch": { name: "Nintendo Switch", region: Region.PAL },
  "PAL Playstation 4": { name: "PlayStation 4", region: Region.PAL },
  "PAL Xbox 360": { name: "Xbox 360", region: Region.PAL },
  "PC Games": { name: "Steam", region: Region.NA },
  PSP: { name: "PlayStation Portable", region: Region.NA },
  "JP PSP": { name: "PlayStation Portable", region: Region.Japan },
  Playstation: { name: "PlayStation", region: Region.NA },
  "Playstation 2": { name: "PlayStation 2", region: Region.NA },
  "Playstation 3": { name: "PlayStation 3", region: Region.NA },
  "Playstation 4": { name: "PlayStation 4", region: Region.NA },
  "Playstation 5": { name: "PlayStation 5", region: Region.NA },
  "Playstation Vita": { name: "PlayStation Vita", region: Region.NA },
  "Sega CD": { name: "Sega CD", region: Region.NA },
  "Sega Dreamcast": { name: "Dreamcast", region: Region.NA },
  "Sega Game Gear": { name: "Sega Game Gear", region: Region.NA },
  "Sega Genesis": { name: "Sega Genesis", region: Region.NA },
  "Super Famicom": {
    name: "Super Nintendo Entertainment System",
    region: Region.Japan,
  },
  "Super Nintendo": {
    name: "Super Nintendo Entertainment System",
    region: Region.NA,
  },
  "TurboGrafx-16": { name: "TurboGrafx-16", region: Region.NA },
  Wii: { name: "Wii", region: Region.NA },
  "Wii U": { name: "Wii U", region: Region.NA },
  WonderSwan: { name: "WonderSwan", region: Region.Japan },
  "WonderSwan Color": { name: "WonderSwan Color", region: Region.Japan },
  Xbox: { name: "Xbox", region: Region.NA },
  "Xbox One": { name: "Xbox One", region: Region.NA },
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
    const gameConsole = offer["console-name"];
    const blConsole = PRICECHARTING_TO_BACKLOGGERY_CONSOLE_MAP[gameConsole];

    // If no matching console in BL, skip it
    if (!blConsole) {
      // console.log(`Missing console: ${gameConsole}`);
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
  await page.goto(`${BACKLOGGERY_URL}/!/login`);
  await page.getByRole("textbox", { name: "username" }).fill(username);
  await page.getByRole("textbox", { name: "password" }).fill(password);
  await page.getByRole("button", { name: "Log In" }).click();
  try {
    await page.waitForFunction(
      (loginUrl) => window.location.href !== loginUrl,
      `${BACKLOGGERY_URL}/!/login`,
      { timeout: 5000 }
    );
  } catch {
    page.close();
    throw new Error("Login failed!");
  }
}

async function getBackloggeryGames(username) {
  const res = await fetch(`${BACKLOGGERY_URL}/api/fetch_library.php`, {
    method: "POST",
    body: JSON.stringify({ type: "load_user_library", username }),
  });
  const json = await res.json();

  const { payload } = json;
  const gamesByConsole = {};
  payload.forEach((game) => {
    const { title, platform_title: console } = game;
    if (!gamesByConsole[console]) {
      gamesByConsole[console] = [title];
    } else {
      gamesByConsole[console].push(title);
    }
  });

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

async function addGames(page, gamesToAdd) {
  await page.goto(`${BACKLOGGERY_URL}/!/add`);

  for (let i = 0; i < gamesToAdd.length; i++) {
    const game = gamesToAdd[i];

    await page.locator('input[type="text"]').first().fill(game.name);
    await page.locator("select").nth(2).selectOption(game.console);
    await page.locator("select").nth(4).selectOption(`${game.region}`);
    await page.getByRole("button", { name: "Stealth Save" }).click();

    await page.waitForTimeout(1000);

    console.log(`${game.name} added`);
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
  const backloggeryGames = await getBackloggeryGames(username);

  // Games to add are those in pricecharting but missing from backloggery
  const gamesToAdd = getGamesToAdd(pricechartingGames, backloggeryGames);
  console.log(gamesToAdd);

  // Start the browser to login and add the games
  const browser = await chromium.launch(/*{ headless: false }*/);
  const page = await browser.newPage();
  await loginToBackloggery(page, username, password);

  if (gamesToAdd.length > 0) {
    await addGames(page, gamesToAdd, username);
    console.log(`${gamesToAdd.length} games added`);
  } else {
    console.log("No games to add");
  }

  await browser.close();
}

run();
