const mechanize = require('mechanize');

const PRICECHARTING_URL = 'https://www.pricecharting.com/offers?seller=2oqzmffhcmudt7gryfywkitjj4&status=collection';

async function getAllOffers() {
  const res = await fetch(PRICECHARTING_URL, {
    headers: {
      accept: 'application/json'
    }
  });

  const json = await res.json();

  let {cursor, offers} = json;

  while(cursor) {
    const nextRes = await fetch(`${PRICECHARTING_URL}&cursor=${cursor}`, {
      headers: {
        accept: 'application/json'
      }
    });

    const nextJson = await nextRes.json();

    cursor = nextJson.cursor;
    offers = offers.concat(nextJson.offers);
  }

  return offers;
}

async function run() {
  // Fetch all games from pricecharting
  const gamesByConsole = {};
  const offers = await getAllOffers();

  offers.forEach(offer => {
    const game = { name: offer['product-name'] };

    if(!gamesByConsole[offer['console-name']]) {
      gamesByConsole[offer['console-name']] = [game];
    } else {
      gamesByConsole[offer['console-name']].push(game);
    }
  });

  // console.log(gamesByConsole);

  // Fetch games from backloggery
}

run();
