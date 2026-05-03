import qrcode from "qrcode-terminal";

export function renderQrLines(url: string): string[] {
  let rendered = "";
  qrcode.generate(url, { small: true }, (output) => {
    rendered = output;
  });
  return rendered
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/g, ""))
    .filter((line, index, array) => line.length > 0 || index < array.length - 1);
}
