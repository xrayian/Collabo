import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/**
 * GET /api/download?type=installer|portable
 * Serves the compiled Collabo Desktop Windows installer directly,
 * or redirects to the GitHub release artifact if not stored locally.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const type = searchParams.get('type') || 'installer';

  const GITHUB_REPO = 'xrayian/Collabo';
  const GITHUB_RELEASE_URL = `https://github.com/${GITHUB_REPO}/releases/latest/download/Collabo.Setup.1.0.0.exe`;
  const GITHUB_PORTABLE_URL = `https://github.com/${GITHUB_REPO}/releases/latest/download/Collabo.1.0.0.exe`;

  const fileName = type === 'portable' ? 'Collabo 1.0.0.exe' : 'Collabo Setup 1.0.0.exe';
  const localFilePath = path.join(process.cwd(), 'release', fileName);

  if (fs.existsSync(localFilePath)) {
    try {
      const stats = fs.statSync(localFilePath);
      const fileStream = fs.createReadStream(localFilePath);

      // Convert Node readable stream to Web ReadableStream for Next.js App Router
      const readableStream = new ReadableStream({
        start(controller) {
          fileStream.on('data', (chunk) => controller.enqueue(chunk));
          fileStream.on('end', () => controller.close());
          fileStream.on('error', (err) => controller.error(err));
        },
      });

      return new NextResponse(readableStream, {
        headers: {
          'Content-Type': 'application/vnd.microsoft.portable-executable',
          'Content-Length': stats.size.toString(),
          'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
          'Cache-Control': 'public, max-age=3600',
        },
      });
    } catch (err) {
      console.warn('[Download API] Error streaming local file, falling back to GitHub release:', err);
    }
  }

  // Fallback: Redirect to GitHub release artifact
  const targetUrl = type === 'portable' ? GITHUB_PORTABLE_URL : GITHUB_RELEASE_URL;
  return NextResponse.redirect(targetUrl, 302);
}
