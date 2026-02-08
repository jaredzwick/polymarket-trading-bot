import type { BotEvent, EventType } from "../types";

type EventHandler<T = unknown> = (event: BotEvent<T>) => void | Promise<void>;

export interface IEventBus {
  emit<T>(type: EventType, data: T): void;
  on<T>(type: EventType, handler: EventHandler<T>): () => void;
  off<T>(type: EventType, handler: EventHandler<T>): void;
  once<T>(type: EventType, handler: EventHandler<T>): () => void;
}

export class EventBus implements IEventBus {
  private handlers = new Map<EventType, Set<EventHandler>>();

  emit<T>(type: EventType, data: T): void {
    const event: BotEvent<T> = {
      type,
      timestamp: new Date(),
      data,
    };
    const typeHandlers = this.handlers.get(type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          handler(event);
        } catch (err) {
          console.error(`Event handler error for ${type}:`, err);
        }
      }
    }
  }

  on<T>(type: EventType, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler as EventHandler);
    return () => this.off(type, handler);
  }

  off<T>(type: EventType, handler: EventHandler<T>): void {
    this.handlers.get(type)?.delete(handler as EventHandler);
  }

  once<T>(type: EventType, handler: EventHandler<T>): () => void {
    const wrappedHandler: EventHandler<T> = (event) => {
      this.off(type, wrappedHandler);
      handler(event);
    };
    return this.on(type, wrappedHandler);
  }
}
