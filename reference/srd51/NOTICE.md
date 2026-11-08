# D&D 2014 — Rules Reference

This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.

Canonical source: https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf
SHA-256: 2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0

Markdown formatting: https://github.com/your5e/5e-srd-markdown (CC-BY-4.0), revision f1f5060fd975aa2ffc3e4b336560ded479934d80. The PDF in that revision is byte-identical to the canonical source. See CONVERSION-NOTES.md for the converter's declared layout adaptations. This package restores five introductory/legal sections omitted from its split files, using the same revision's complete Markdown. The brief Sample Traps introduction is also restored in the Traps page.

Our formatting adaptations: restore explicit proficient saving-throw lists and remove the converter's inferred non-proficient saving-throw row; join the PDF line-wrap hyphen in thunderwave. Rules prose is rendered as descriptive Markdown, without evaluating character formulas. Curated condition links are separate related-reference metadata; they do not rewrite the source text.

Coverage: 999 substantive/reference source entries plus an About/Sources page. Every prose paragraph and table (normalized length >=10 characters; standalone grouping headings excluded) from the complete converted document is accounted for. Every non-blank official PDF page is mapped in coverage.json; page 2 is intentionally blank. PDF heading extraction determines the source jump location. Full official PDF and canonical text are retained for audit. This is the SRD, not the full commercial rulebooks or the 2024 rules.

Rebuild: python3 reference/build_srd51.py
Verify: python3 -m unittest discover -s reference -v
The build is network-free. Input files, hashes, source keys and generated output are versioned. No private character files or third-party commercial packs are included.
