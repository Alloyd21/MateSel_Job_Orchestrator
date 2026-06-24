# LinkedIn Post — MateSel Job Orchestrator

## Option A

MateSel is the software we use to work out which animals to mate with which — balancing genetic gain against inbreeding to get the best mating plan for a program.

At 3D Genetics we run it constantly — over a thousand runs in a year across our programs, and we're already past 700 this season.

The runs themselves are fine. The annoying part was setting them all up: copying a folder, editing trait and marker weightings by hand, running it, then doing it again with slightly different numbers. Do that a few hundred times and you start losing track of which run was which.

So I built a tool to do it for me.

You point it at one starter folder, tell it which weightings to vary, and it builds every combination, queues them up, and runs them. You can watch the console live for each one, and every run gets its own folder with a record of exactly what was changed.

What used to be a morning of fiddling with text files is now a few clicks.

Built it with Electron, React and TypeScript.

---

## Option B — shorter

MateSel works out which animals to mate to balance genetic gain against inbreeding, and we run it a lot at 3D Genetics — 700+ runs already this season. Setting them all up by hand was the painful bit: copy a folder, tweak the weightings, run it, repeat, lose track.

So I built a tool that does it instead. Give it one starter folder and the weightings you want to vary, and it generates every combination, queues them, and runs them — with a live console for each and a record of what changed.

A morning of editing text files, down to a few clicks.

Built with Electron, React and TypeScript.

---

## Notes
- Add a screenshot or a short screen recording — it'll do more than any caption.
- Put the GitHub link in the first comment, not the post.
- If you've got a real before/after number, drop it in — it makes the whole thing land harder.



## My Version

We run MateSel a lot at 3D Genetics. With over 700 runs already this season, it's an essential part of our breeding program. 

To manage all these runs I built an orchestrator GUI. Load in your existing projects or give it one starter project and the weightings you want to vary, and it generates every combination, queues them, and runs them, with a live console for each.

Built with Electron, React and TypeScript. Open source and available on GitHub.
