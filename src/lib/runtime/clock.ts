/**
 * Horloge injectable — jamais Date.now() implicite dans les scanners.
 */

export type Clock = {
  now(): Date;
};

export function createFixedClock(isoOrDate: string | Date): Clock {
  const fixed =
    typeof isoOrDate === "string" ? new Date(isoOrDate) : new Date(isoOrDate);
  if (Number.isNaN(fixed.getTime())) {
    throw new Error("runtime_clock_invalid");
  }
  return {
    now() {
      return new Date(fixed.getTime());
    },
  };
}

export function createSystemClock(): Clock {
  return {
    now() {
      return new Date();
    },
  };
}
