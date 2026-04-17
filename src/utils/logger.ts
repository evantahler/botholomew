import ansis from "ansis";

function ts(): string {
  return ansis.gray(new Date().toTimeString().slice(0, 8));
}

export const logger = {
  info(msg: string) {
    console.log(ts(), ansis.blue("ℹ"), msg);
  },

  success(msg: string) {
    console.log(ts(), ansis.green("✓"), msg);
  },

  warn(msg: string) {
    console.log(ts(), ansis.yellow("⚠"), msg);
  },

  error(msg: string) {
    console.error(ts(), ansis.red("✗"), msg);
  },

  debug(msg: string) {
    if (process.env.BOTHOLOMEW_DEBUG) {
      console.log(ts(), ansis.gray("·"), ansis.gray(msg));
    }
  },

  dim(msg: string) {
    console.log(ts(), ansis.dim(msg));
  },

  phase(name: string, detail?: string) {
    const tag = ansis.magenta.bold(`[[${name}]]`);
    if (detail) {
      console.log(ts(), tag, ansis.dim(detail));
    } else {
      console.log(ts(), tag);
    }
  },
};
