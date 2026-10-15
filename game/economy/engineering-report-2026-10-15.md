# Field engineering study — 2026-10-15

Profile **ARES-LAB/1**, Common tier. Local game assumptions, not NASA/Mars agronomic validation. No RPC, wallet, token balances, real orders or rewards. One sol = 24.66 simulated h; growth requires 96 light-equivalent h. Histories and sessions are separate from the live Field ledger.

| Scenario | SIM h | Crop | Health % | Stored kg | Spoiled kg | Process loss kg | Battery kWh | Reservoir L | Unserved kWh |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Managed cycle + powered cold storage | 272.62 | empty | 100.00 | 18.00 | 0.00 | 0.00 | 12.00 | 32.70 | 0.00 |
| Pump fault, no repair | 172.62 | dead | 0.00 | 0.00 | 0.00 | 0.00 | 12.00 | 100.00 | 0.00 |
| Pump repaired after 6 h | 178.62 | empty | 100.00 | 18.00 | 0.00 | 0.00 | 12.00 | 29.94 | 0.00 |
| Dust event, 2 sols | 172.62 | mature | 100.00 | 0.00 | 0.00 | 0.00 | 7.35 | 36.43 | 10.11 |
| Harvest, uncooled storage 100 h | 272.62 | empty | 100.00 | 0.00 | 18.00 | 0.00 | 12.00 | 32.70 | 0.00 |
| Process 5 kg, then uncooled storage 100 h | 284.62 | empty | 100.00 | 4.25 | 13.00 | 0.75 | 12.00 | 32.70 | 0.00 |

Processing reserves existing food and works over time at finite power/rate; it does not create extra input mass. A raw batch held warm expires by this fictional profile; powered cooling slows equivalent age. Total food accounting includes inventory + processing feed + spoiled mass + processing losses = harvested SIM mass. POTATO cannot spoil and is not affected by these scenarios.
