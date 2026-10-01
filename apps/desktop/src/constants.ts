/** The launch argument by which main hands the preload the shell's facts (so `window.cbDesktop.info` needs no synchronous IPC). A constant file so the preload imports nothing heavy. */
export const INFO_ARG = "--cb-info=";
