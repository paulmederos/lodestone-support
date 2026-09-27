#!/usr/bin/env python3
"""Generates the tuning pages (guitar, bass, ukulele, violin) as static HTML.

Run from the repo root:  python3 tools/build_pages.py
Notes, octaves and frequencies are computed from A4 = 440 Hz; tunings mirror
js/tunings.js and the app's Instruments.swift. Edit the PAGES data, re-run,
commit the generated files (the site has no build step when it's served).
"""
import html, json, os

APP_URL = "https://apps.apple.com/us/app/lodestone-guitar-tuner/id6782477642"
SITE = "https://lodestone.paulmederos.com"
THREE = "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.min.js"
SHARP = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"]
FLAT = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"]
ORD = {1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th", 6: "6th"}
WORDS = {1: "half step", 2: "whole step", 3: "step and a half"}

def freq(m): return 440 * 2 ** ((m - 69) / 12)
def name(m, flats=False): return (FLAT if flats else SHARP)[m % 12]
def octave(m): return m // 12 - 1
def full(m, flats=False): return f"{name(m, flats)}{octave(m)}"

GUITAR_STD = [40, 45, 50, 55, 59, 64]

# ------------------------------------------------------------------ the pages --
PAGES = [
  dict(path="guitar-tuning", key="guitar.standard", strings=GUITAR_STD, numbered=True,
    title="Standard Guitar Tuning: E A D G B E, Notes and Hz",
    desc="Standard guitar tuning is E A D G B E, from the thickest string to the thinnest. See each string's note, octave and frequency, tap a string to hear it, or tune with your mic.",
    h1="Standard guitar tuning",
    answer="Standard guitar tuning is E A D G B E, from the thickest string (the 6th, nearest your face) to the thinnest (the 1st).",
    body=[
      "The two E strings are the same note two octaves apart: the low E rings at 82.41 Hz and the high E at 329.63 Hz. A handy way to remember the order is <em>Eddie Ate Dynamite, Good Bye Eddie</em>.",
      "Tap any string above to hear its note, or turn on the mic and play. The string you're tuning lights up, and it glows brighter as you get close.",
    ],
    howto_title="Tuning the strings to each other",
    howto=[
      "Tune the low E first, with the mic or by ear against the tone above.",
      "Press the low E at the 5th fret. That's an A: tune the open A string to match.",
      "Press the A string at the 5th fret and tune the open D to it. Do the same from D to G.",
      "Press the G string at the <strong>4th</strong> fret (the one exception) and tune the open B to it.",
      "Press the B string at the 5th fret and tune the high E to match.",
    ],
    faq=[
      ("What are the six guitar string notes?", "E, A, D, G, B and E, from the thickest string to the thinnest. In scientific pitch they're E2, A2, D3, G3, B3 and E4."),
      ("Which string is the 6th string?", "The thickest one, nearest your face when you play. Strings are numbered from the thinnest (1st, high E) to the thickest (6th, low E)."),
      ("Why are there two E strings?", "The low E and the high E are the same note two octaves apart (82.41 Hz and 329.63 Hz), so a lot of chords ring out with the root on the top and bottom."),
      ("What does A440 mean?", "It's the reference pitch: the A above middle C vibrates at 440 Hz, and every other note is tuned relative to it. Lodestone uses A440."),
    ]),
]

ALTERNATES = [
  dict(slug="drop-d", tname="Drop D", strings=[38, 45, 50, 55, 59, 64],
    answer="Drop D tuning is D A D G B E: standard tuning with the 6th string lowered a whole step, from E to D.",
    body=["With the low string on D, the bottom three strings (D A D) make a power chord you can play with one finger, and the open low D gives you a deeper note to lean on."],
    howto=["Play the open 4th string (D). Lower the 6th string until it rings the same note an octave below.",
           "Check it with harmonics: the 12th-fret harmonic on the 6th string should match the open 4th string."],
    faq=[("How far do I lower the low E for drop D?", "One whole step, which is two half steps or 200 cents: from E2 (82.41 Hz) down to D2 (73.42 Hz). The other five strings stay in standard tuning.")]),
  dict(slug="half-step-down", tname="Half step down", strings=[39, 44, 49, 54, 58, 63], flats=True,
    answer="Half step down tuning is E♭ A♭ D♭ G♭ B♭ E♭: every string lowered one half step from standard. It's also called E♭ standard.",
    body=["The chord shapes don't change, so everything you know in standard tuning still works. It all just sounds a half step lower, and the strings feel a little looser."],
    howto=["Lower every string by one half step (100 cents): E to E♭, A to A♭, D to D♭, G to G♭, B to B♭, E to E♭."],
    faq=[("Is half step down the same as E flat tuning?", "Yes. Half step down, E♭ standard and E♭ tuning all mean E♭ A♭ D♭ G♭ B♭ E♭.")]),
  dict(slug="d-standard", tname="D standard", strings=[38, 43, 48, 53, 57, 62],
    answer="D standard tuning is D G C F A D: every string lowered a whole step from standard.",
    body=["Like half step down, the chord shapes stay the same and everything sounds lower, here by a whole step."],
    howto=["Lower every string by a whole step (200 cents): E to D, A to G, D to C, G to F, B to A, E to D."],
    faq=[("How is D standard different from drop D?", "Drop D lowers only the 6th string (D A D G B E). D standard lowers all six strings a whole step (D G C F A D).")]),
  dict(slug="drop-c", tname="Drop C", strings=[36, 43, 48, 53, 57, 62],
    answer="Drop C tuning is C G C F A D: D standard with the 6th string dropped another whole step, to C.",
    body=["It works like drop D, a whole step lower: the bottom three strings (C G C) make a one-finger power chord."],
    howto=["Tune to D standard first (every string down a whole step).", "Then lower the 6th string one more whole step, until it rings an octave below the open 4th string (C)."],
    faq=[("How do I get from standard tuning to drop C?", "Lower every string a whole step, then lower the 6th string one more whole step. You end up with C G C F A D.")]),
  dict(slug="dadgad", tname="DADGAD", strings=[38, 45, 50, 55, 57, 62],
    answer="DADGAD tuning is D A D G A D: from standard, lower the 6th, 2nd and 1st strings a whole step.",
    body=["The open strings make a chord that's neither major nor minor, which is why DADGAD is loved for Celtic and folk fingerstyle playing."],
    howto=["Lower the 6th string from E to D.", "Lower the 2nd string from B to A.", "Lower the 1st string from E to D. The A, D and G strings stay put."],
    faq=[("Is DADGAD major or minor?", "Neither. The open strings are D, A and G, with no third, so they sound open and ringing (a Dsus4 chord).")]),
  dict(slug="open-g", tname="Open G", strings=[38, 43, 50, 55, 59, 62],
    answer="Open G tuning is D G D G B D: from standard, lower the 6th, 5th and 1st strings a whole step. Strum the open strings and you hear a G major chord.",
    body=["Because the open strings already make a chord, open G is a favorite for slide guitar: lay the slide across any fret for a major chord."],
    howto=["Lower the 6th string from E to D.", "Lower the 5th string from A to G.", "Lower the 1st string from E to D. The D, G and B strings stay put."],
    faq=[("What chord do the open strings make in open G?", "G major: the notes are G, B and D.")]),
  dict(slug="open-d", tname="Open D", strings=[38, 45, 50, 54, 57, 62],
    answer="Open D tuning is D A D F♯ A D: lower the 6th, 2nd and 1st strings a whole step and the 3rd string a half step. The open strings ring a D major chord.",
    body=["Open D keeps the root on both the lowest and highest strings, so open chords sound full and wide."],
    howto=["Lower the 6th string from E to D.", "Lower the 3rd string from G to F♯ (a half step).", "Lower the 2nd string from B to A.", "Lower the 1st string from E to D."],
    faq=[("What chord do the open strings make in open D?", "D major: the notes are D, F♯ and A.")]),
]
for a in ALTERNATES:
    PAGES.append(dict(path=f"guitar-tuning/{a['slug']}", key=f"guitar.{a['slug']}", strings=a["strings"], numbered=True,
        flats=a.get("flats", False), vs_standard=True,
        title=f"{a['tname']} Tuning: {' '.join(name(m, a.get('flats', False)) for m in a['strings'])}, Notes and Hz",
        desc=a["answer"] + " See each string's note and frequency, hear it, or tune with your mic.",
        h1=f"{a['tname']} tuning", answer=a["answer"],
        body=a["body"] + ["Tap a string above to hear its note, or turn on the mic: the string you're tuning lights up and glows brighter as you get close."],
        howto_title=f"How to tune to {a['tname']}", howto=a["howto"], faq=a["faq"]))

PAGES += [
  dict(path="bass-tuner", key="bass.standard", strings=[28, 33, 38, 43], numbered=True, instrument="bass",
    title="Bass Tuner: Standard Bass Tuning E A D G, Notes and Hz",
    desc="Standard bass tuning is E A D G, an octave below a guitar's four lowest strings. Tune your bass with your mic in the browser, or hear each string.",
    h1="Bass tuner",
    answer="Standard bass tuning is E A D G, from the thickest string to the thinnest: the same notes as a guitar's four lowest strings, one octave lower.",
    body=["The low E on a bass is E1, at 41.20 Hz. A 5-string bass adds a low B below it (B0, 30.87 Hz), and drop D lowers the E to D.",
          "Turn on the mic and play a string. Phone and laptop mics hear low notes faintly, so play firmly and keep the bass close."],
    extra_tables=[("5-string bass: B E A D G", [23, 28, 33, 38, 43]), ("Drop D bass: D A D G", [26, 33, 38, 43])],
    howto_title="Tuning a bass",
    howto=["Tune the low E first. It's the deepest note, so give it a firm pluck.",
           "Press the E string at the 5th fret and tune the open A to it. Do the same from A to D, and from D to G.",
           "On a 5-string, tune the low B so that its 5th fret matches the open E."],
    faq=[("Is bass tuned to E1 or E2?", "E1. A standard bass's low E is E1 (41.20 Hz), an octave below a guitar's low E (E2, 82.41 Hz)."),
         ("What are the notes on a 5-string bass?", "B E A D G. The extra low B is B0, at 30.87 Hz."),
         ("Can I tune a bass with my phone?", "Yes. Lodestone listens for notes down to a 5-string's low B. Play firmly, since small mics pick up the lowest notes more faintly.")]),
  dict(path="ukulele-tuner", key="ukulele.standard", strings=[67, 60, 64, 69], numbered=True, instrument="ukulele",
    title="Ukulele Tuner: Standard Ukulele Tuning G C E A, Notes and Hz",
    desc="Standard ukulele tuning is G C E A, with a high G. Tune your ukulele with your mic in the browser, hear each string, or switch to low G or baritone.",
    h1="Ukulele tuner",
    answer="Standard ukulele tuning is G C E A. The G is tuned high (G4), above the C, which is why a ukulele's strings don't run from low to high.",
    body=["Soprano, concert and tenor ukuleles all use G C E A. Some players tune the G an octave lower (low G, G3) for a deeper sound, and the baritone ukulele uses D G B E, the same as a guitar's top four strings.",
          "The classic way to remember it is to sing <em>My Dog Has Fleas</em> to the four open strings."],
    extra_tables=[("Low G ukulele: G C E A", [55, 60, 64, 69]), ("Baritone ukulele: D G B E", [50, 55, 59, 64])],
    howto_title="Tuning a ukulele",
    howto=["Tune the A string first (A4, 440 Hz).",
           "Press the E string at the 5th fret. That's an A: tune the E string until it matches the open A.",
           "Press the C string at the 4th fret. That's an E: tune the C string until it matches the open E.",
           "Press the E string at the 3rd fret. That's a G: tune the open G to match it (an octave lower for low G)."],
    faq=[("What are the ukulele string notes?", "G C E A. In scientific pitch: G4, C4, E4 and A4, with the G above the C (re-entrant tuning)."),
         ("Should I use high G or low G?", "High G is the traditional bright ukulele sound. Low G (G3) adds a deeper bass note. Both use the same chord shapes."),
         ("How is a baritone ukulele tuned?", "D G B E, the same as the top four strings of a guitar.")]),
  dict(path="violin-tuner", key="violin.standard", strings=[55, 62, 69, 76], numbered=True, instrument="violin",
    title="Violin Tuner: Violin Tuning G D A E, Notes and Hz",
    desc="A violin is tuned G D A E in fifths, with A at 440 Hz. Tune your violin with your mic in the browser, or hear each string.",
    h1="Violin tuner",
    answer="A violin is tuned G D A E, from the lowest string to the highest, each string a fifth above the last: G3, D4, A4 (440 Hz) and E5.",
    body=["Most violinists tune the A string first, to 440 Hz, then tune the D, G and E to it. Use the pegs for big changes and the fine tuners for the last few cents."],
    howto_title="Tuning a violin",
    howto=["Tune the A string to 440 Hz with the mic, or match the A tone above.",
           "Tune the D, then the G, then the E. Each open string is a perfect fifth from its neighbor.",
           "Make big changes with the pegs and small ones with the fine tuners, then check the A again."],
    faq=[("What are the violin string notes?", "G, D, A and E, from lowest to highest: G3 (196 Hz), D4 (293.66 Hz), A4 (440 Hz) and E5 (659.26 Hz)."),
         ("Which violin string should I tune first?", "The A string, to 440 Hz. It's the reference the other strings are tuned from.")]),
]

# ------------------------------------------------------------------- rendering --
def rel(depth): return "../" * depth

def table(strings, flats, numbered=True, vs=None):
    n = len(strings)
    rows = []
    for i, m in enumerate(strings):
        num = n - i if numbered else i + 1
        change = ""
        if vs:
            d = vs[i] - m
            change = f"<td>{'no change' if d == 0 else f'{WORDS.get(d, str(d) + ' half steps')} down from {name(vs[i])}'}</td>"
        rows.append(f"<tr><td>{ORD.get(num, num)}</td><td class='note'>{name(m, flats)}</td><td>{full(m, flats)}</td><td>{freq(m):.2f} Hz</td>{change}</tr>")
    head = "<th>String</th><th>Note</th><th>Pitch</th><th>Frequency</th>" + ("<th>From standard</th>" if vs else "")
    return f"<table class='notes'><thead><tr>{head}</tr></thead><tbody>{''.join(rows)}</tbody></table>"

def related(current):
    links = []
    for p in PAGES:
        if p["path"] == current: continue
        label = p["h1"].replace(" tuning", "").replace("Standard guitar", "Standard") if p["path"].startswith("guitar-tuning") else p["h1"]
        notes = " ".join(name(m, p.get("flats", False)) for m in p["strings"])
        links.append((p["path"], label, notes))
    return links

def page(p):
    depth = p["path"].count("/") + 1
    r = rel(depth)
    flats = p.get("flats", False)
    notes_line = " ".join(name(m, flats) for m in p["strings"])
    faq_ld = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in p["faq"]]}
    app_ld = {"@context": "https://schema.org", "@type": "MobileApplication", "name": "Lodestone Guitar Tuner",
              "operatingSystem": "iOS 17 or later", "applicationCategory": "MultimediaApplication", "url": APP_URL,
              "offers": {"@type": "Offer", "price": "0.99", "priceCurrency": "USD"}}
    crumbs = [{"@type": "ListItem", "position": 1, "name": "Lodestone", "item": SITE + "/"}]
    if p["path"].startswith("guitar-tuning/"):
        crumbs.append({"@type": "ListItem", "position": 2, "name": "Guitar tuning", "item": f"{SITE}/guitar-tuning/"})
    crumbs.append({"@type": "ListItem", "position": len(crumbs) + 1, "name": p["h1"], "item": f"{SITE}/{p['path']}/"})
    crumb_ld = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": crumbs}

    extra = "".join(f"<h3>{html.escape(t)}</h3>{table(s, False)}" for t, s in p.get("extra_tables", []))
    vs = GUITAR_STD if p.get("vs_standard") else None
    rel_links = "".join(f"<a class='tuning-card' href='{r}{path}/'><span class='t'>{html.escape(label)}</span><span class='n'>{notes}</span></a>"
                        for path, label, notes in related(p["path"]))
    faq_html = "".join(f"<details><summary>{html.escape(q)}</summary><p>{html.escape(a)}</p></details>" for q, a in p["faq"])
    howto = "".join(f"<li>{s}</li>" for s in p["howto"])
    body = "".join(f"<p>{s}</p>" for s in p["body"])
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>{html.escape(p['title'])} · Lodestone</title>
<meta name="description" content="{html.escape(p['desc'])}" />
<link rel="canonical" href="{SITE}/{p['path']}/" />
<meta name="theme-color" content="#0b0917" />
<link rel="icon" href="{r}assets/favicon-32.png" sizes="32x32" />
<link rel="apple-touch-icon" href="{r}assets/apple-touch-icon.png" />
<link rel="stylesheet" href="{r}style.css" />
<link rel="stylesheet" href="{r}strings.css" />
<link rel="stylesheet" href="{r}tunings.css" />
<meta property="og:title" content="{html.escape(p['h1'])}: {notes_line}" />
<meta property="og:description" content="{html.escape(p['answer'])}" />
<meta property="og:type" content="article" />
<meta property="og:url" content="{SITE}/{p['path']}/" />
<meta property="og:image" content="{SITE}/assets/icon-512.png" />
<script type="importmap">{{"imports": {{"three": "{THREE}"}}}}</script>
<script type="application/ld+json">{json.dumps(faq_ld, ensure_ascii=False)}</script>
<script type="application/ld+json">{json.dumps(app_ld)}</script>
<script type="application/ld+json">{json.dumps(crumb_ld)}</script>
</head>
<body class="tuning-page">
  <header class="site-head flow">
    <a class="brand" href="{r}"><img src="{r}assets/favicon-32.png" alt="" /> lodestone</a>
    <span class="head-actions">
      <a class="head-link" href="{r}guitar-tuning/">Tunings</a>
      <a class="btn btn-sm" href="{APP_URL}">Get the app</a>
    </span>
  </header>

  <main>
    <section class="tuning-hero">
      <div class="wrap">
        <h1>{html.escape(p['h1'])}</h1>
        <p class="answer">{p['answer']}</p>
      </div>
      <div class="wrap wide">
        <div data-strings data-tuning="{p['key']}"></div>
      </div>
    </section>

    <section class="section tight">
      <div class="wrap">
        <h2>{html.escape(p['h1'].replace(' tuner', ''))} notes and frequencies</h2>
        {table(p['strings'], flats, vs=vs)}
        <p class="table-note">Frequencies use A4 = 440 Hz. Strings are numbered from the thinnest.</p>
        {extra}
        {body}
      </div>
    </section>

    <section class="section tight">
      <div class="wrap">
        <h2>{html.escape(p['howto_title'])}</h2>
        <ol class="steps">{howto}</ol>
      </div>
    </section>

    <section class="section tight">
      <div class="wrap">
        <h2>Questions</h2>
        <div class="faq">{faq_html}</div>
      </div>
    </section>

    <section class="section tight">
      <div class="wrap">
        <h2>More tunings</h2>
        <div class="tuning-grid">{rel_links}</div>
      </div>
    </section>

    <section class="section cta">
      <div class="wrap">
        <img class="cta-icon" src="{r}assets/icon-512.png" width="96" height="96" alt="The Lodestone app icon" />
        <h2>Lodestone for iPhone</h2>
        <p class="lead">A beautiful tuner that opens listening. Pick your instrument to see its strings, with the one you're tuning lit up. 99¢, once. No ads, no accounts, no subscription.</p>
        <a class="appstore" href="{APP_URL}" aria-label="Download Lodestone on the App Store">
          <img src="{r}assets/Download_on_App_Store/Black_lockup/SVG/Download_on_the_App_Store_Badge_US-UK_RGB_blk_092917.svg" width="160" height="53" alt="Download on the App Store" />
        </a>
      </div>
    </section>
  </main>

  <footer>
    <div class="wrap">
      <span>© <span id="y"></span> Enchant</span>
      <span class="spacer"></span>
      <nav>
        <a href="{r}guitar-tuning/">Guitar</a>
        <a href="{r}bass-tuner/">Bass</a>
        <a href="{r}ukulele-tuner/">Ukulele</a>
        <a href="{r}violin-tuner/">Violin</a>
        <a href="{r}support.html">Support</a>
        <a href="{r}privacy.html">Privacy</a>
      </nav>
    </div>
  </footer>
  <script>document.getElementById("y").textContent = new Date().getFullYear();</script>
  <script type="module" src="{r}js/strings.js"></script>
</body>
</html>
"""

if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for p in PAGES:
        out = os.path.join(root, p["path"], "index.html")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        open(out, "w").write(page(p))
        print("wrote", os.path.relpath(out, root))
