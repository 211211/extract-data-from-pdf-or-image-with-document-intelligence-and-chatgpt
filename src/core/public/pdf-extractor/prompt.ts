export const textPrompt = `
Extract all biomarker data from the provided document content and output it in JSON format as follows: 
[
  {
    "biomarker_name": "name of the biomarker",
    "biomarker_value": "value of the biomarker",
    "unit": "unit of the biomarker",
    "reference_range": "reference range of the biomarker",
    "category": "category that biomarker belongs to"
  }
]

**Instructions**:
- If a biomarker has multiple values, units, or reference ranges, create separate entries for each. For example:
  Input: "Haematology Neutrophils 66 % 5.5 x 10^9/L (2.0 - 7.0)"
  Result: [
    {"biomarker_name": "Neutrophils", "biomarker_value": "66", "unit": "%", "reference_range": "NA", "category": "Haematology"},
    {"biomarker_name": "Neutrophils", "biomarker_value": "5.5", "unit": "10^9/L", "reference_range": "(2.0 - 7.0)", "category": "Haematology"}
  ]
- If the reference range is textual (e.g., Nil, Negative, Positive), format it as the normal value in "reference_range".
- Include biomarkers like Blood Group, Urine Transparency, Colour, etc., if they exist in the document.
- Do not confuse reference range tables or unrelated tables with biomarker data; focus only on actual biomarker entries.
- Maintain the exact text as presented in the document for values, units, and ranges.
- Return only the JSON output without wrapping it in code blocks (e.g., do not include \`\`\`json).
- If information for any required field is missing, use 'NA' as the default value.
- If a value contains a unit, attempt to split it into separate "biomarker_value" and "unit" fields.
- Keep all numbers as text (strings) in the output.
- Replace any instance of 'None' with 'NA'.
- Do not include the unit in the "reference_range" field; keep it clean of unit symbols.
- For common units like x10^9/L, x10^9g/L, x10^12g/L, x10^12, x10^12 g/L, x10^12/L, x10^6, x10^6 g/L, x10^6/L, format them prettily (e.g., "10^9/L", "10^12 g/L") in the "unit" field.
- The input content may be in plain text or markdown format (e.g., tables, headings). Parse the structure accordingly to identify biomarker data, especially from tables if present.
- If the document contains structured data like tables, prioritize extracting biomarker data from those tables over plain text descriptions.
- Ignore irrelevant sections such as headers, footers, or notes that do not contain biomarker data.

**Output**:
Return only the JSON array of biomarker data as specified above.
`;
