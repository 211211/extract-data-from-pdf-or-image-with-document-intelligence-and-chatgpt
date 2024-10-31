During my time working at MODEC, I'm writing this example to show off abilities of document intelligence and chatgpt using to extract data from given pdf/image file.

The flow should be:

1. User to upload pdf/image file via a form
2. Making call to our API: `/api/v1/pdf-extractor`
3. Calling Document Intelligence to extract the text. Ref: `src/core/public/pdf-extractor/pdf-extractor.service.ts`
4. Get the response from step 3 and make call to chat gpt with pre-defined prompt
5. Expect to get the response as following from GPT (gpt-4o)

```
[
  {
    "biomarker_name": "MPV",
    "biomarker_value": "9",
    "unit": "NA",
    "reference_range": "9.00 -13 .00",
    "category": "Hematology"
  }
]
```

I hard-coded the base64 version of sample pdf file in `/sample/sample.pdf`. Please check: `src/core/public/pdf-extractor/pdf-extractor.service.ts`

## Installation

```bash
$ npm install -g yarn
$ yarn install
```

## Running the app

```bash
# Install dependencies
$ yarn install

# development
$ yarn start

# watch mode
$ yarn start:dev
```

## Test
```bash
curl --location 'localhost:8083/api/v1/pdf-extractor' \
--form 'file=@"/your/path/to/sample.pdf"'
```

## License

admin@nguyenhongquan.com
