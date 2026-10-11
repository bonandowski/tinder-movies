# Tinder Movies

Web app mobile-first "Tinder per film" per scegliere insieme cosa guardare la sera (2+ persone):
si crea una stanza, gli altri entrano con un codice breve, tutti swipano la stessa pila di film
(destra = sì, sinistra = no) e quando tutti dicono sì allo stesso film compare **Match!**.

**Stack:** Python + FastAPI (WebSocket per il realtime, stanze in memoria, nessun DB) ·
React + Vite + TypeScript · dati film da [TMDB](https://www.themoviedb.org) (paese IT, lingua it-IT).

## Stato

| Fase | Contenuto | Stato |
|------|-----------|-------|
| 0 | Scaffolding, README | fatto |
| 1 | Backend: client TMDB + `/api/movies` con filtri | in corso |
| 2 | Stanze e WebSocket | da fare |
| 3 | Frontend: stanza, filtri, swipe | da fare |
| 4 | Match e "meno peggio" a fine pila | da fare |
| 5 | Rifinitura logica di matching e test | da fare |

## Chiave TMDB

1. Crea un account su <https://www.themoviedb.org/signup>.
2. Vai su <https://www.themoviedb.org/settings/api> e richiedi una chiave **Developer** (uso non commerciale).
3. Copia `.env.example` in `.env` e incolla la chiave in `TMDB_API_KEY`. Il file `.env` è ignorato da git.

## Attribuzione

This product uses the TMDB API but is not endorsed or certified by TMDB.
