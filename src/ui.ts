// Tiny ANSI helpers, no dependency.
const E = (n: number) => `\x1b[${n}m`;
const c = (n: number) => (s: string) => E(n) + s + E(0);

export const dim = c(2);
export const bold = c(1);
export const gray = c(90);
export const red = c(31);
export const green = c(32);
export const yellow = c(33);
export const blue = c(34);
export const magenta = c(35);
export const cyan = c(36);
export const gold = (s: string) => `\x1b[1;33m${s}\x1b[0m`;

export function colorScore(score: number | null): string {
  if (score == null) return gray('?/10');
  if (score >= 8) return gold(`${score}/10`);
  if (score >= 6) return yellow(`${score}/10`);
  if (score >= 4) return blue(`${score}/10`);
  return gray(`${score}/10`);
}

export function colorSpread(cents: number | null): string {
  if (cents == null) return gray('?');
  const dollars = `$${(cents / 100).toFixed(0)}`;
  if (cents >= 50000) return gold(dollars);
  if (cents >= 20000) return green(dollars);
  if (cents >= 5000) return cyan(dollars);
  return gray(dollars);
}

export function rule(label?: string, color = gray): string {
  const w = process.stdout.columns || 80;
  if (!label) return color('─'.repeat(Math.min(w, 80)));
  const left = '── ' + label + ' ';
  const fill = '─'.repeat(Math.max(0, Math.min(w, 80) - left.length));
  return color(left + fill);
}

export function banner() {
  console.log(gold('  arb') + dim('  facebook marketplace arbitrage'));
}

// minimal yes/no prompt
export async function confirm(message: string, defaultYes = false): Promise<boolean> {
  process.stdout.write(`${message} ${dim(defaultYes ? '[Y/n]' : '[y/N]')} `);
  return new Promise((resolve) => {
    const onData = (buf: Buffer) => {
      const ans = buf.toString().trim().toLowerCase();
      process.stdin.removeListener('data', onData);
      process.stdin.pause();
      if (ans === '') return resolve(defaultYes);
      resolve(ans === 'y' || ans === 'yes');
    };
    process.stdin.resume();
    process.stdin.once('data', onData);
  });
}
