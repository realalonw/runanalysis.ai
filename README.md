# RunAnalysis.AI

An AI-powered platform for analyzing videos, images, and documents with OpenAI's GPT and Vision APIs.
Notes: this was created before Gemini dropped their latest video analysis update. The main trickiness in making this project was extracting frames and sending them for analysis, but now, it's basically 'worthless' (it works, it provides you with detailed and accurate analysis, but it's not any new technology). Enjoy!

## Features

- 📁 Upload and analyze various file types (images, videos, PDFs, text files)
- 🤖 AI-powered analysis using OpenAI's GPT-4 and Vision APIs
- 🎯 Clean, responsive user interface
- 🔄 Real-time file previews
- 📱 Mobile-friendly design

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- OpenAI API key

## Getting Started

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/runanalysis.ai.git
   cd runanalysis.ai
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   Create a `.env` file in the root directory with the following content:
   ```
   PORT=5000
   NODE_ENV=development
   OPENAI_API_KEY=your_openai_api_key_here
   MAX_FILE_SIZE=104857600  # 100MB
   UPLOAD_DIR=./uploads
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

5. **Open in your browser**
   Visit `http://localhost:5000` to access the application.

## Project Structure

```
runanalysis.ai/
├── public/               # Static files
│   ├── index.html         # Main HTML file
│   └── js/                # Client-side JavaScript
│       └── main.js        # Main application logic
├── server/                # Server-side code
│   └── index.js           # Express server and API routes
├── uploads/               # Directory for uploaded files (created automatically)
├── .env                  # Environment variables
├── package.json          # Project metadata and dependencies
└── README.md             # This file
```

## Usage

1. **Upload a file**
   - Click the upload area or drag and drop a file
   - Supported file types: images (JPG, PNG, GIF), videos (MP4, MOV, AVI), documents (PDF, DOCX, TXT)
   - Maximum file size: 100MB

2. **Analyze with AI**
   - Click the "Analyze with AI" button
   - Wait for the analysis to complete
   - View the results in the analysis section

3. **Start a new analysis**
   - Click "Start New Analysis" to upload another file

## Configuration

You can modify the following environment variables in the `.env` file:

- `PORT`: The port the server will run on (default: 5000)
- `OPENAI_API_KEY`: Your OpenAI API key (required)
- `MAX_FILE_SIZE`: Maximum file size in bytes (default: 100MB)
- `UPLOAD_DIR`: Directory to store uploaded files (default: ./uploads)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with Node.js, Express, and OpenAI API
- UI powered by Tailwind CSS
- Icons from Heroicons
