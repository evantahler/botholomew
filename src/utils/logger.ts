import ansis from "ansis";

export const logger = {
  info(msg: string) {
    console.log(ansis.blue("ℹ"), msg);
  },

  success(msg: string) {
    console.log(ansis.green("✓"), msg);
  },

  warn(msg: string) {
    console.log(ansis.yellow("⚠"), msg);
  },

  error(msg: string) {
    console.error(ansis.red("✗"), msg);
  },

  debug(msg: string) {
    if (process.env.BOTHOLOMEW_DEBUG) {
      console.log(ansis.gray("·"), ansis.gray(msg));
    }
  },

  dim(msg: string) {
    console.log(ansis.dim(msg));
  },
};
