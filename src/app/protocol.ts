import type { Season } from "../gen/season";

/** Messages from the page to the generator worker. */
export type ToWorker =
  | { type: "init"; seed: string }
  | {
      /** The tiles the page is waiting for, most urgent first. Replaces any earlier list. */
      type: "want";
      scale: number;
      season: Season;
      /** tile ids, see tileId() */
      tiles: number[];
      /** tiles the page has thrown away since its last message */
      dropped: number[];
    }
  | { type: "svg"; id: number; camX: number; width: number }
  | {
      /** A finished picture (paper, sky, ink) of a stretch of the scroll. */
      type: "png";
      id: number;
      camX: number;
      width: number;
      /** pixels per world unit */
      scale: number;
      season: Season;
      hour: number;
    };

/** Messages from the generator worker to the page. */
export type FromWorker =
  | {
      type: "tile";
      id: number;
      scale: number;
      season: Season;
      bitmap: ImageBitmap;
      /** what the tile shows, for the soundscape */
      mounts: number;
      boats: number;
    }
  | { type: "svg"; id: number; svg: string }
  | { type: "png"; id: number; blob?: Blob; error?: string };
