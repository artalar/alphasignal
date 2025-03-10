// https://github.com/alexeyraspopov/picocolors

type ColorFormatter = (input: unknown) => string

let formatter =
  (open: string, close: string, replace: string = open): ColorFormatter =>
  (input: unknown): string => {
    let string = '' + input,
      index = string.indexOf(close, open.length)
    return index !== -1
      ? open + replaceClose(string, close, replace, index) + close
      : open + string + close
  }

let replaceClose = (
  string: string,
  close: string,
  replace: string,
  index: number,
): string => {
  let result = '',
    cursor = 0
  do {
    result += string.substring(cursor, index) + replace
    cursor = index + close.length
    index = string.indexOf(close, cursor)
  } while (index !== -1)
  return result + string.substring(cursor)
}

export const COLOR = {
  reset: (input: unknown) => formatter('\x1b[0m', '\x1b[0m')(input),
  bold: (input: unknown) => formatter('\x1b[1m', '\x1b[22m', '\x1b[22m\x1b[1m')(input),
  dim: (input: unknown) => formatter('\x1b[2m', '\x1b[22m', '\x1b[22m\x1b[2m')(input),
  italic: (input: unknown) => formatter('\x1b[3m', '\x1b[23m')(input),
  underline: (input: unknown) => formatter('\x1b[4m', '\x1b[24m')(input),
  inverse: (input: unknown) => formatter('\x1b[7m', '\x1b[27m')(input),
  hidden: (input: unknown) => formatter('\x1b[8m', '\x1b[28m')(input),
  strikethrough: (input: unknown) => formatter('\x1b[9m', '\x1b[29m')(input),

  black: (input: unknown) => formatter('\x1b[30m', '\x1b[39m')(input),
  red: (input: unknown) => formatter('\x1b[31m', '\x1b[39m')(input),
  green: (input: unknown) => formatter('\x1b[32m', '\x1b[39m')(input),
  dimGreen: (input: unknown) => formatter('\x1b[32;2m', '\x1b[39;22m')(input),
  yellow: (input: unknown) => formatter('\x1b[33m', '\x1b[39m')(input),
  blue: (input: unknown) => formatter('\x1b[34m', '\x1b[39m')(input),
  magenta: (input: unknown) => formatter('\x1b[35m', '\x1b[39m')(input),
  cyan: (input: unknown) => formatter('\x1b[36m', '\x1b[39m')(input),
  white: (input: unknown) => formatter('\x1b[37m', '\x1b[39m')(input),
  gray: (input: unknown) => formatter('\x1b[90m', '\x1b[39m')(input),

  bgBlack: (input: unknown) => formatter('\x1b[40m', '\x1b[49m')(input),
  bgRed: (input: unknown) => formatter('\x1b[41m', '\x1b[49m')(input),
  bgGreen: (input: unknown) => formatter('\x1b[42m', '\x1b[49m')(input),
  bgYellow: (input: unknown) => formatter('\x1b[43m', '\x1b[49m')(input),
  bgBlue: (input: unknown) => formatter('\x1b[44m', '\x1b[49m')(input),
  bgMagenta: (input: unknown) => formatter('\x1b[45m', '\x1b[49m')(input),
  bgCyan: (input: unknown) => formatter('\x1b[46m', '\x1b[49m')(input),
  bgWhite: (input: unknown) => formatter('\x1b[47m', '\x1b[49m')(input),

  blackBright: (input: unknown) => formatter('\x1b[90m', '\x1b[39m')(input),
  redBright: (input: unknown) => formatter('\x1b[91m', '\x1b[39m')(input),
  greenBright: (input: unknown) => formatter('\x1b[92m', '\x1b[39m')(input),
  yellowBright: (input: unknown) => formatter('\x1b[93m', '\x1b[39m')(input),
  blueBright: (input: unknown) => formatter('\x1b[94m', '\x1b[39m')(input),
  magentaBright: (input: unknown) => formatter('\x1b[95m', '\x1b[39m')(input),
  cyanBright: (input: unknown) => formatter('\x1b[96m', '\x1b[39m')(input),
  whiteBright: (input: unknown) => formatter('\x1b[97m', '\x1b[39m')(input),

  bgBlackBright: (input: unknown) => formatter('\x1b[100m', '\x1b[49m')(input),
  bgRedBright: (input: unknown) => formatter('\x1b[101m', '\x1b[49m')(input),
  bgGreenBright: (input: unknown) => formatter('\x1b[102m', '\x1b[49m')(input),
  bgYellowBright: (input: unknown) => formatter('\x1b[103m', '\x1b[49m')(input),
  bgBlueBright: (input: unknown) => formatter('\x1b[104m', '\x1b[49m')(input),
  bgMagentaBright: (input: unknown) => formatter('\x1b[105m', '\x1b[49m')(input),
  bgCyanBright: (input: unknown) => formatter('\x1b[106m', '\x1b[49m')(input),
  bgWhiteBright: (input: unknown) => formatter('\x1b[107m', '\x1b[49m')(input),
}
