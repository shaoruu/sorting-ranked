# SORTING.EXE

21 sorting algorithms race on the same array, with sound. Ranked by steps.

**Live:** https://sorting-ranked.vercel.app

## How the race works

Every algorithm is a generator that yields one op at a time. Each compare, swap, write, or read into a buffer is one step, and every racer gets the same number of steps per frame, so finish order is the ranking. Holding a single value in a variable (an insertion key, a quicksort pivot) is free.

The **overall** tab runs every algorithm on all five inputs (random, reversed, nearly sorted, few unique, already sorted) and ranks them by the geometric mean of their step counts.

## Sound

Click a panel to listen to it. Each step plays a tone pitched by the value being touched (120 Hz to 1220 Hz, the mapping from those old sorting videos), and finished arrays get the green sweep. `all` mixes up to four racers at once.

## Algorithms

Bubble, Cocktail Shaker, Odd-Even, Gnome, Comb, Selection, Insertion, Binary Insertion, Shell (Ciura gaps), Merge, Tim (simplified), Quick (Hoare), Quick (Lomuto), Heap, Radix LSD, Radix MSD, Bitonic, Cycle, Pancake, Stooge, Bogo.

## Dev

```sh
pnpm install
pnpm dev
pnpm verify # checks every algorithm actually sorts every input
```
