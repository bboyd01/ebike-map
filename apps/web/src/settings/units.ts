export const MPH = 0.44704; // m/s per mph
export const KMH = 1 / 3.6; // m/s per km/h
export const LB = 0.45359237; // kg per lb

export const mphToMps = (mph: number) => mph * MPH;
export const mpsToMph = (mps: number) => mps / MPH;
export const mpsToKmh = (mps: number) => mps * 3.6;
