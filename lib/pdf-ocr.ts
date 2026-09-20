import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const MAX_OCR_PAGES = 40;

export async function extractPdfTextWithOcr(
  data: Uint8Array,
  totalPages: number,
) {
  const pageLimit = Math.min(totalPages, MAX_OCR_PAGES);
  const workDir = await mkdtemp(join(tmpdir(), 'reits-pdf-ocr-'));
  const pdfPath = join(workDir, 'source.pdf');
  const imagePrefix = join(workDir, 'page');
  await writeFile(pdfPath, data);

  try {
    await execFile(
      'pdftoppm',
      [
        '-jpeg',
        '-r',
        '180',
        '-f',
        '1',
        '-l',
        String(pageLimit),
        pdfPath,
        imagePrefix,
      ],
      { timeout: 180_000, maxBuffer: 20 * 1024 * 1024 },
    );
  } catch {
    throw new Error('OCR运行环境缺少PDF渲染组件');
  }

  const images = (await readdir(workDir))
    .filter((name) => /^page-\d+\.jpg$/i.test(name))
    .sort((left, right) => pageNumber(left) - pageNumber(right));
  const pages: string[] = [];
  for (const image of images) {
    try {
      const { stdout } = await execFile(
        'tesseract',
        [join(workDir, image), 'stdout', '-l', 'chi_sim+eng', '--psm', '3'],
        {
          encoding: 'utf8',
          timeout: 90_000,
          maxBuffer: 20 * 1024 * 1024,
        },
      );
      const text = stdout.replace(/\s+/g, ' ').trim();
      if (text) pages.push(`[第${pageNumber(image)}页] ${text}`);
    } catch {
      throw new Error('OCR识别失败');
    }
  }
  if (!pages.length) throw new Error('OCR未识别出可用文字');
  return pages.join('\n');
}

function pageNumber(name: string) {
  return Number(name.match(/-(\d+)\.jpg$/i)?.[1] || 0);
}
