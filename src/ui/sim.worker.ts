import { alerts, education, debtBurdens, durables, governmentDebt, leverStages, tutorial, research, explanations, history, moneyFlows, fiscal, sectoralBalance, cohortViews, cohorts, commercialBank, countrySummary, createWorld, sampleCitizen, deserialize, industries, moneyHolders, productMarkets, moneyLog, moneySupply, serialize, step, type Command } from "../sim";
import type { FromWorker, Snapshot, Speed, ToWorker } from "./protocol";

const TICK_MS = 1000;

let world = createWorld(Math.floor(Math.random() * 2 ** 31), { gradualUnlock: true });
let speed: Speed = 0;
let queued: Command[] = [];
let zoomSlot = 0;
let flowWindow = 30;
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
    fiscal: fiscal(world),
    sectoral: sectoralBalance(world),
    education: education(world),
    research: research(world),
    flowWindow,
    flows: moneyFlows(world, flowWindow === 0 ? 0 : Math.max(0, world.tick - flowWindow), world.tick),
    history: history(world),
    notes: explanations(world),
    stages: leverStages(world),
    alerts: alerts(world),
    tutorial: tutorial(world),
    durables: durables(world),
    debt: governmentDebt(world),
    burdens: debtBurdens(world),
    pensionRate: world.pensionRate,
    pensionsPaid: world.pensionsPaid,
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
    case "setFlowWindow":
      flowWindow = message.ticks;
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
