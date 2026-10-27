# GazBook

A Windows app that turns a book manuscript into Amazon KDP-ready files:

- **Paperback PDF**: your chosen KDP trim size, mirrored margins with the right
  inside (gutter) margin for the page count, chapters on right-hand pages, drop
  caps, running heads, page numbers, no widows or orphans, fonts embedded.
- **Kindle EPUB 3**: contents page, landmarks, Kindle-safe drop caps, optional cover.
- **Word (.docx)**: same page setup, real Word drop caps, Heading 1 chapters.

It reads Word (.docx, including Google Docs downloads), PDF (with real text,
not scans), plain text and Markdown. While reading it also tidies the text:
straight quotes become curly quotes, `--` becomes an em dash, `...` becomes an
ellipsis, extra spaces and empty lines go, scene breaks (`***`, `#`) are kept,
and the old copyright and contents pages are replaced.

Optional translation: Google Translate (about 250 languages, needs a Google
Cloud key) or Claude (any language you can name, needs an Anthropic key).
Print PDFs are made for Latin, Greek and Cyrillic scripts; for other scripts the
app makes the EPUB and Word files and says so.

**Cover maker** (tab 2): works out the full paperback cover size the same way
as Amazon's cover calculator (trim + spine from page count and paper + 0.125"
bleed), estimates the US print cost and royalty, writes the back cover blurb
and tagline from the manuscript (Claude), makes prompts for AI picture makers,
searches free pictures that allow commercial use (Openverse, plus Pexels with a
free key) and keeps only ones big enough for 300 DPI, then saves a print-ready
cover PDF (front, spine, back, barcode space) and a Kindle cover JPG.

## Install

Download `GazBook-Setup-x.y.z.exe` from the latest release and run it.

## Develop

```
npm install
npm start        # run the app
npm test         # build sample books from .md, .docx and .pdf
npm run dist     # Windows installer in dist/ (run on Windows)
```

Code: `src/` is the engine (read, pdf, epub, docx, translate), `app/` is the
Electron window. Fonts in `fonts/` are under the SIL Open Font License.

## Plans

GazBook has a 7-day free trial with everything on. After that a yearly plan
unlocks it (bought at https://gazgoc.com.ng/gazbook/):

| Plan | Price a year | Adds |
| --- | --- | --- |
| Starter | ₦20,000 ($14) | PDF, EPUB and Word files |
| Writer | ₦50,000 ($36) | cover maker |
| Publisher | ₦90,000 ($64) | translation, Claude back cover |
| Studio | ₦150,000 ($107) | many languages in one go |

The code comes by email and is checked offline (`src/license.js`) against Gaz
Media's public key. The GazPresenter Plans WordPress plugin (GAZPRESENTER repo,
`website/gazpresenter-plans/`) sells the plans and makes the codes; its
GazPresenter → GazBook admin page gives access by hand and shows the admins'
unlimited codes.
