import { createWorld, sampleCitizen, deserialize, serialize, step, type Command } from "../sim";
import { buildSnapshot } from "./snapshot";
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
  return buildSnapshot(world, speed, queued, flowWindow);
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
