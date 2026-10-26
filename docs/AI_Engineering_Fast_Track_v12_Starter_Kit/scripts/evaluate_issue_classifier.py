"""Score a member-generated CSV without exposing a completed AI solution.
Usage: python scripts/evaluate_issue_classifier.py evidence/w1_predictions.csv
Header: issue_id,predicted_category,predicted_priority
"""
from pathlib import Path
import csv,json,sys
if len(sys.argv)!=2:sys.exit('Usage: python scripts/evaluate_issue_classifier.py <predictions.csv>')
root=Path(__file__).resolve().parents[1]
gold={r['issue_id']:r for r in json.loads((root/'data/evaluation/issue_classification_gold.json').read_text())}
with open(sys.argv[1],newline='',encoding='utf-8') as f:rows={r['issue_id']:r for r in csv.DictReader(f)}
if set(rows)!=set(gold):sys.exit(f'Expected {len(gold)} distinct case IDs; got {len(rows)}')
cat=sum(rows[k]['predicted_category'].strip()==v['category'] for k,v in gold.items())
prio=sum(rows[k]['predicted_priority'].strip()==v['priority'] for k,v in gold.items())
critical_misses=[k for k,v in gold.items() if v['priority']=='P1' and rows[k]['predicted_priority'].strip()!='P1']
print(f'Category accuracy: {cat}/{len(gold)} = {cat/len(gold):.1%}')
print(f'Priority accuracy: {prio}/{len(gold)} = {prio/len(gold):.1%}')
print(f'Critical P1 misses: {critical_misses}')
