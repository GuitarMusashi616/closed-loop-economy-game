import { cohortViews, cohorts, commercialBank, countrySummary, createWorld, sampleCitizen, deserialize, industries, moneyHolders, productMarkets, moneyLog, moneySupply, serialize, step, type Command } from "../sim";
import type { FromWorker, Snapshot, Speed, ToWorker } from "./protocol";

const TICK_MS = 1000;

let world = createWorld(Math.floor(Math.random() * 2 ** 31));
let speed: Speed = 0;
let queued: Command[] = [];
let zoomSlot = 0;
let timer: ReturnType<typeof setInterval> | undefined;

const send = (message: FromWorker) => postMessage(message);

function snapshot(): Snapshot {
  return {
    seed: world.seed,
    tick: world.tick,
    speed,
    moneySupply: moneySupply(world),
    holders: moneyHolders(world),
    log: moneyLog(world),
    cohorts: cohorts(world),
    households: cohortViews(world),
    summary: countrySummary(world),
    industries: industries(world),
    products: productMarkets(world),
    wageMarkup: world.markups.wages ?? 0,
    bank: commercialBank(world),
    queued,
  };
}

function advance() {
  try {
    world = step(world, queued).world;
    queued = [];
  } catch (error) {
    // A rejected command is dropped so it cannot wedge every later Tick.
    queued = [];
    speed = 0;
    send({ type: "error", message: String(error instanceof Error ? error.message : error) });
  }
  send({ type: "snapshot", snapshot: snapshot() });
}

function applySpeed() {
  clearInterval(timer);
  timer = speed === 0 ? undefined : setInterval(advance, TICK_MS / speed);
}

onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  switch (message.type) {
    case "command":
      queued = [...queued, message.command];
      break;
    case "step":
      advance();
      return;
    case "setSpeed":
      speed = message.speed;
      applySpeed();
      break;
    case "zoom":
      try {
        // A fresh slot each time so repeated zooms show different Citizens.
        send({ type: "citizen", citizen: sampleCitizen(world, message.cohortId, zoomSlot++) });
      } catch (error) {
        send({ type: "error", message: String(error instanceof Error ? error.message : error) });
      }
      return;
    case "save":
      send({ type: "saved", save: serialize(world) });
      return;
    case "load":
      try {
        world = deserialize(message.save);
        queued = [];
        speed = 0;
        applySpeed();
      } catch (error) {
        send({ type: "error", message: `Could not load save: ${error instanceof Error ? error.message : error}` });
      }
      break;
  }
  send({ type: "snapshot", snapshot: snapshot() });
};

send({ type: "snapshot", snapshot: snapshot() });
