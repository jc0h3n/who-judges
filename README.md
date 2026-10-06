# Who Judges

> "The Federal Judiciary is hardly a cross-section of America. Take, for example, this Court, which consists of only nine men and women, all of them successful lawyers who studied at Harvard or Yale Law School."
> Justice Antonin Scalia, dissenting in *Obergefell v. Hodges*, 2015

Who sits on America's courts: every federal judge since 1789 and every sitting state supreme court justice, by gender, race and ethnicity, age, schooling and the careers that led to the bench, set against the lawyers and the public they serve. A companion to [An Exact Portrait](https://github.com/jc0h3n/an-exact-portrait), on Congress.

**Views**

- **Federal courts**: any date since 1789, any court level, active or senior, by appointing party or circuit. Demographics, the road to the bench (prosecutors, public defenders, clerks, state judges), law schools, appointing presidents and ABA ratings, each set against all U.S. adults
- **Over time**: women, people of color, age, prosecutors and defenders, Harvard and Yale, every year since 1790
- **State supreme courts**: all 53 state courts of last resort, with gender, race on record, age, appointment or election, party and law school, plus a weekly log of who joins and leaves
- **Compared with the country**: judges against U.S. adults, the workforce and the legal profession
- **Judges**: a searchable table with CSV download

## Data

| Source | Used for | Updated |
|---|---|---|
| [Federal Judicial Center](https://www.fjc.gov/history/judges), Biographical Directory of Article III Federal Judges | Every federal judge: service, demographics, education, careers, ABA ratings, Senate votes | Weekly (public domain) |
| Wikipedia, each state high court's article | Sitting state supreme court justices, appointing governor and party, law school, race and ethnicity from categories | Weekly (CC BY-SA) |
| [Wikidata](https://www.wikidata.org) | State justices' gender and birth year | Weekly (CC0) |
| [Census Bureau population estimates](https://www.census.gov/programs-surveys/popest.html) | U.S. adults by sex, race, Hispanic origin and age | Weekly check; new vintage yearly |
| [Census Bureau, CPS educational attainment](https://www.census.gov/topics/education/educational-attainment/data/tables.html) | Adults with graduate and professional degrees | Weekly check; new table yearly |
| [Bureau of Labor Statistics](https://www.bls.gov/cps/) | Workforce, lawyers, and judges by sex and race (CPS table 11); veterans (CPS series LNU00049526) | Weekly check; new figures yearly |
| [American Bar Association](https://www.americanbar.org/news/profile-legal-profession/) | Number and demographics of U.S. lawyers | By hand, yearly (`data/aba.json`): the ABA blocks automated downloads |

State courts have no official national roster, so the state data comes from Wikipedia and is only as good as its editors. Race and ethnicity from Wikipedia categories are incomplete: treat them as lower bounds. Lower state courts (about 30,000 judges) aren't covered at all; there's no open, person-level source.

## How it stays current

A GitHub Action (`.github/workflows/deploy.yml`) runs every Monday. It refetches every source, commits the refreshed state roster, the weekly change log (`data/state-history.json`) and the benchmarks to the repository, rebuilds `site/data/judges.json`, and redeploys the site. If any source can't be reached, the last good copy in `data/` is kept, so the site never goes blank.

## Privacy

The site is static. It loads no fonts, analytics, trackers or third-party scripts, and the browser only requests files from this site.

## Running it locally

Requires Node.js 20 or newer. No packages to install.

```
npm run data    # download sources and build site/data/judges.json
npm run serve   # http://localhost:8080
```
