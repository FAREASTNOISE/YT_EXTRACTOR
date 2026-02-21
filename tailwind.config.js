/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./**/*.{html,js,php}", // サブフォルダ内を含むすべてのhtml, js, phpを監視
    "./*.{html,js,php}"      // ルートの直下用
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
