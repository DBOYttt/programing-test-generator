# Programming Task Generator

A powerful web application that generates custom programming tasks with visualizations based on user-selected criteria.

<img width="799" alt="image" src="https://github.com/user-attachments/assets/d7b8b6d3-1763-4cc2-8c54-69b93df8bc08" />


## Features

- **Multiple Task Types**: Select from various task types (games, algorithms, data structures, web applications, etc.)
- **Multi-Language Support**: Generate tasks for multiple programming languages
- **Visualizations**: Auto-generate flowcharts, application structure diagrams, and GUI mockups
- **PDF Export**: Get beautifully formatted PDF files with task descriptions
- **Customization Options**: Upload your own pattern or use text input

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [API Reference](docs/API.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Contributing](docs/CONTRIBUTING.md)
- [License](#license)

## Installation

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- OpenAI API key

### Steps

1. Clone the repository:

```bash
git clone https://github.com/yourusername/programming-task-generator.git
cd programming-task-generator
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file in the root directory with your OpenAI API key:

```
OPENAI_API_KEY=your_api_key_here
```

4. Start the server:

```bash
npm start
```

The application will be available at `http://localhost:3000`.

## Usage

1. Open your browser and navigate to `http://localhost:3000`
2. Select one or more task types
3. Choose the programming language(s)
4. Select the output language for instructions
5. Enable/disable visualization options
6. Enter a pattern template or upload a PDF
7. Click "Generate PDF"
8. Save the generated PDF file

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | Port for the server | 3000 |
| OPENAI_API_KEY | Your OpenAI API key | - |

## Wiki 
see more in Wiki tab

## Credits

- OpenAI GPT-4 for content generation
- Mermaid.js for diagram generation
- Puppeteer for PDF creation
