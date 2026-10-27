# Willingness-to-pay call auction for price discovery

Each Tick runs a uniform-price call auction per Product. Cohort demand comes from Willingness to Pay (need urgency, budget, drifting taste, substitutes), and Industries post asks learned from sales feedback, with unit cost only a soft floor. We rejected a cost-anchored reference price and incremental price drift because today's price must come from today's demand and stock, so it falls back when supply catches up and cannot ratchet upward. The cost is more compute per Tick, and demand curves need careful tuning.
