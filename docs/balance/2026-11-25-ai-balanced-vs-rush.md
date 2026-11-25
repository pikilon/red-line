# Balanced vs rush AI (issue 492)

Balanced win share over decided games, 3 maps (first-line, river-port, hostomel) x 12 seeds x both seats.

| Faction | Before (#531) | After |
|---|---|---|
| ukraine | 7 % | 37 % |
| russia | 31 % | 33 % |
| usa | 66 % | 70 % |

Changes: `alertRadiusCenti` (4500) on the balanced AIs holds launches and recalls attackers while enemy ground units are near the base; production no longer stops during a defense (Zero Hour refills teams before a new wave); Ukraine balanced opens with a vehicle factory and mechanized/armor forces. China was not merged and is not covered.
