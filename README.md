# GazBook

A Windows app that turns a book manuscript into Amazon KDP-ready files.

## One click (new in 1.5)

Put the book in, tick the languages, press **Make my books**. In about a
minute (on a normal 4–8 core laptop, for a 50,000-word book and a few
languages) you get one folder and one zip with, for every language:

- paperback PDF, Kindle EPUB and Word file
- Kindle cover (JPG) and paperback cover (PDF, sized like Amazon's cover
  calculator for that language's page count)
- the author's "About the Author" page with photo, translated
- the Amazon listing (description, 7 keywords, categories, author bio) and a
  plain-words upload guide, including Amazon's AI-translation question
- a "Google Play Books" folder: every language ready for Google's Partner
  Center (with ISBNs: files named by ISBN and a filled-in book list, all
  languages in one upload; without: a folder per language with the details to copy)
- a cover design request for Gemini, built from the book: Gemini designs the
  front cover using only GazBook's 22 bundled cover fonts (fonts/cover, SIL OFL)
  and gives back the same picture with no words plus a short design card;
  GazBook redraws that design (art, fonts, colours, places) in every language
- a "words" request for Gemini (catchy descriptions, taglines, keywords)

### Your own marketing kit (new in 1.7)

Already have a marketing kit (Amazon description, cover prompt, keywords,
categories, about the author) in Word, PDF or text, in one file or several?
Put it in at step 1 ("Your marketing kit"). GazBook finds each part by its
heading and uses it **exactly as written**: the description goes on Amazon word
for word (its opening paragraphs, up to about 170 words, go on the back
cover), the keywords are packed into Amazon's 7 boxes of 50 characters (the
rest are listed as extra keywords for Google Play and Kobo), the first 3
categories are for upload and the rest are listed to ask Amazon to add, and
the cover prompt is saved as is and offered with a Copy button. Only the
parts the kit does not have are made by GazBook. For other languages the
kit's description and keywords are translated. At step 3, "Already have a
finished front cover?" puts a cover that already shows the title and name on
the front unchanged, with a matching spine and back (original language only).

No keys and no fees: translation runs on the computer (`translator/`,
CTranslate2 with free OPUS-MT and M2M100 models). Each language is
downloaded once from this repository's `models-v1` release, made by the
**Build translator files** workflow (run it once from the Actions tab).
Only languages Amazon accepts are offered. `npm run speed` checks the
one-minute promise with a same-size test translator.

## Everything else ("More tools")

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

Other translators: on this computer (free, see above), Google free, Google
Translate (needs a Google Cloud key), Gemini or Claude (need a key).
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
npm run speed    # the one-minute check (needs: pip install ctranslate2 sentencepiece numpy)
npm run dist     # Windows installer in dist/, with its own small Python for the translator
```

Code: `src/` is the engine (read, pdf, epub, docx, translate, quick = the
one-click job, kit-offline = the listing), `app/` is the Electron window
(`ui/quick.html` is the one-click screens), `translator/` is the on-computer
translator and the scripts that build its language files. Fonts in `fonts/` are under the SIL Open Font License.

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
