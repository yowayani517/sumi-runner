import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// build時: JS/CSS/3Dモデルを全て1つのindex.htmlに埋め込む。
// これで dist/index.html を file:// でダブルクリックしても動く(サーバー不要)。
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'esnext',              // トップレベルawaitを保持
    assetsInlineLimit: 1024 * 1024 * 1024, // 全アセットをdata URI化
    chunkSizeWarningLimit: 100000,
    cssCodeSplit: false,
  },
});
