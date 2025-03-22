// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const multer = require('multer');
const pdfParse = require('pdf-parse');

const app = express();

// Configure storage for uploaded files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Configure multer for file uploads
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Accept only PDF files
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

// Middleware setup
app.use(express.json());
app.use(express.static('public'));

// Initialize OpenAI API client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Check if API key is set
if (!process.env.OPENAI_API_KEY) {
  console.warn('Warning: OPENAI_API_KEY environment variable is not set');
}

// Home route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Helper function for compatibility with older Puppeteer versions
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Function to create a fallback diagram if Mermaid code has syntax issues
function createSafeMermaidWrapper(diagramCode, title) {
  // Basic validation - check if it has some structure
  const hasSyntaxParts = diagramCode.includes('-->') || 
                          diagramCode.includes('---') || 
                          diagramCode.includes('|') || 
                          diagramCode.includes('(');
                          
  if (!hasSyntaxParts) {
    // Return a very basic fallback diagram
    return `flowchart TD
    error["Could not generate ${title} visualization."]
    note["Please try again with different settings."]
    error --> note`;
  }
  
  return diagramCode;
}

// Format multiple languages into a readable string for prompts
function formatLanguagesForPrompt(languages) {
  if (languages.length === 1) {
    return languages[0];
  } else if (languages.length === 2) {
    return `${languages[0]} and ${languages[1]}`;
  } else {
    const lastLang = languages[languages.length - 1];
    const otherLangs = languages.slice(0, -1).join(', ');
    return `${otherLangs}, and ${lastLang}`;
  }
}

// Generate from PDF route
app.post('/generate-from-pdf', upload.single('pdfFile'), async (req, res) => {
  let browser = null;
  let tempHtmlPath = null;
  let pdfPath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    let taskTypes;
    try {
      taskTypes = JSON.parse(req.body.taskTypes);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid task types format' });
    }
    
    if (!Array.isArray(taskTypes) || taskTypes.length === 0) {
      return res.status(400).json({ error: 'At least one task type must be selected' });
    }
    
    let languages;
    try {
      languages = JSON.parse(req.body.languages);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid languages format' });
    }
    
    if (!Array.isArray(languages) || languages.length === 0) {
      return res.status(400).json({ error: 'At least one programming language must be selected' });
    }
    
    const { outputLanguage } = req.body;
    const withAlgorithmChart = req.body.withAlgorithmChart === 'true';
    const withAppStructure = req.body.withAppStructure === 'true';
    const withGuiVisualization = req.body.withGuiVisualization === 'true';
    
    console.log(`Processing PDF and generating ${taskTypes.join(', ')} task using ${languages.join(', ')} (${outputLanguage})...`);
    
    // Extract text from the uploaded PDF
    const dataBuffer = fs.readFileSync(req.file.path);
    
    // Parse the PDF file
    const data = await pdfParse(dataBuffer);
    const pattern = data.text;
    
    // Clean up the uploaded file
    fs.unlink(req.file.path, (err) => {
      if (err) {
        console.error('Error deleting temporary PDF file:', err);
      }
    });
    
    // Format task types for the prompt
    const taskTypeString = formatTaskTypes(taskTypes);
    
    // Create language prompt based on number of languages
    const languagePrompt = languages.length > 1 
      ? `Create a multi-language solution using ${formatLanguagesForPrompt(languages)}. Include code examples or explanations for each language where appropriate. Focus on how the languages would interact or how the solution would differ between languages.`
      : `Implement the solution in ${languages[0]}.`;
    
    // Generate content using OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system", 
          content: `You are a programming task generator. Generate a programming task following the same structure as the provided pattern but with a different problem to solve. 
                   Format the output with Markdown headings (### for main sections, #### for subsections) and use proper Markdown formatting for lists and important points. 
                   The output should be in ${outputLanguage} language.`
        },
        {
          role: "user",
          content: `Pattern: ${pattern}\n\n
                  Create a new programming task following this pattern but for ${taskTypeString}.
                  ${languagePrompt}
                  The task should incorporate elements from all the specified types.
                  The task description should be written in ${outputLanguage}.`
        }
      ],
    });
    
    const generatedTask = completion.choices[0].message.content;
    console.log('Task generated successfully');
    
    // Generate visualizations if requested
    let algorithmChartCode = '';
    let appStructureCode = '';
    let guiVisualizationCode = '';
    
    if (withAlgorithmChart || withAppStructure) {
      // Get visualizations
      const visualizationsResponse = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system", 
            content: `You are an expert in creating Mermaid diagrams for software documentation. Generate clear, well-organized diagrams that visualize software components and algorithms.`
          },
          {
            role: "user",
            content: `Based on the following programming task description, create two Mermaid diagrams:
                    ${withAlgorithmChart ? '1. A flowchart showing the algorithm or main process flow described in the task.' : ''}
                    ${withAppStructure ? `${withAlgorithmChart ? '2' : '1'}. A class diagram or component diagram showing the structure of the application described in the task.` : ''}
                    
                    Only provide the Mermaid code blocks. Use the latest Mermaid syntax and make the diagrams visually clear.
                    
                    Task description: ${generatedTask}`
          }
        ],
      });
      
      const visualizationsContent = visualizationsResponse.choices[0].message.content;
      
      // Extract Mermaid code blocks
      if (withAlgorithmChart) {
        const algorithmChartMatch = visualizationsContent.match(/```mermaid\s*(flowchart|graph)[\s\S]*?```/i);
        algorithmChartCode = algorithmChartMatch ? algorithmChartMatch[0].replace(/```mermaid\s*|\s*```/g, '') : '';
      }
      
      if (withAppStructure) {
        const appStructureMatch = visualizationsContent.match(/```mermaid\s*(classDiagram|erDiagram|flowchart)[\s\S]*?```/i);
        appStructureCode = appStructureMatch ? appStructureMatch[0].replace(/```mermaid\s*|\s*```/g, '') : '';
        
        // If the first regex didn't match, try a more general one to find any other mermaid diagram
        if (!appStructureCode && withAppStructure) {
          const generalMatch = visualizationsContent.match(/```mermaid[\s\S]*?```/g);
          if (generalMatch && generalMatch.length > (withAlgorithmChart ? 1 : 0)) {
            appStructureCode = generalMatch[withAlgorithmChart ? 1 : 0].replace(/```mermaid\s*|\s*```/g, '');
          }
        }
      }
    }
    
    // Generate GUI visualization if requested
    if (withGuiVisualization) {
      // Get GUI visualization with improved prompting
      const guiVisualizationResponse = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system", 
            content: `You are an expert in creating UI mockups using Mermaid diagrams. 
            Generate simple, valid Mermaid code that represents the user interface described in the task.
            Follow these strict guidelines:
            1. Use flowchart LR or flowchart TD syntax for UI mockups
            2. Keep node IDs short and descriptive (e.g., btn1, input1)
            3. Avoid special characters in node text
            4. Use simple shapes like rectangles and rounded rectangles
            5. Use minimal styling to avoid syntax errors
            6. Ensure all nodes are properly connected
            7. Test your syntax mentally before providing it`
          },
          {
            role: "user",
            content: `Create a simple Mermaid diagram showing a mockup of the UI for the following task. 
            Focus on the main screens or components only. Use the flowchart syntax (NOT stateDiagram).
            
            Task description: ${generatedTask}`
          }
        ],
      });
      
      const guiVisualizationContent = guiVisualizationResponse.choices[0].message.content;
      
      // Extract Mermaid code block with improved regex matching
      const guiMatch = guiVisualizationContent.match(/```(?:mermaid)?\s*(flowchart[\s\S]*?)```/i);
      guiVisualizationCode = guiMatch ? guiMatch[1].trim() : '';
      
      // If no flowchart syntax is found, try to extract any mermaid code block
      if (!guiVisualizationCode) {
        const generalMatch = guiVisualizationContent.match(/```(?:mermaid)?\s*([\s\S]*?)```/i);
        guiVisualizationCode = generalMatch ? generalMatch[1].trim() : '';
      }
      
      // Validate that the code starts with flowchart and has basic structure
      if (guiVisualizationCode && !guiVisualizationCode.toLowerCase().startsWith('flowchart')) {
        guiVisualizationCode = 'flowchart TD\n    ' + guiVisualizationCode;
      }
      
      // If still empty or too short, create a simple fallback diagram
      if (!guiVisualizationCode || guiVisualizationCode.length < 20) {
        const appType = taskTypes.find(type => 
          type.includes('desktop') || type.includes('mobile') || type.includes('web')
        ) || 'application';
        
        guiVisualizationCode = `flowchart TD
        title["${appType.charAt(0).toUpperCase() + appType.slice(1)} UI Mockup"]
        mainScreen["Main Screen"]
        features["Features"]
        
        title --> mainScreen
        mainScreen --> features`;
      }
    }
    
    // Apply safety wrappers to mermaid code
    algorithmChartCode = algorithmChartCode ? createSafeMermaidWrapper(algorithmChartCode, "Algorithm") : '';
    appStructureCode = appStructureCode ? createSafeMermaidWrapper(appStructureCode, "App Structure") : '';
    guiVisualizationCode = guiVisualizationCode ? createSafeMermaidWrapper(guiVisualizationCode, "GUI") : '';
    
    // Include the diagrams in the HTML content
    const taskTypeDisplay = taskTypes.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(', ');
    const languagesDisplay = languages.map(l => l.toUpperCase()).join(', ');
    const htmlContent = generateHtml(generatedTask, languagesDisplay, taskTypeDisplay, outputLanguage, algorithmChartCode, appStructureCode, guiVisualizationCode);
    
    // Create a temporary HTML file
    tempHtmlPath = path.join(__dirname, `temp_${Date.now()}.html`);
    fs.writeFileSync(tempHtmlPath, htmlContent, 'utf8');
    
    // Generate PDF using Puppeteer
    console.log('Creating PDF with Puppeteer...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Set viewport size to ensure diagrams render properly
    await page.setViewport({
      width: 1200,
      height: 1600,
      deviceScaleFactor: 1,
    });
    
    await page.goto(`file://${tempHtmlPath}`, {
      waitUntil: 'networkidle0',
      timeout: 60000 // Increase timeout to allow Mermaid diagrams to render
    });
    
    // Wait for Mermaid diagrams to render
    try {
      await page.waitForFunction(() => {
        const diagrams = document.querySelectorAll('.mermaid');
        return Array.from(diagrams).every(diagram => diagram.querySelector('svg') || diagram.querySelector('.error-message'));
      }, { timeout: 10000 });
    } catch (e) {
      console.warn('Timeout waiting for diagrams to render, proceeding anyway');
    }
    
    // Additional wait to ensure complete rendering - using setTimeout instead of waitForTimeout
    await delay(2000);
    
    pdfPath = path.join(__dirname, `temp_${Date.now()}.pdf`);
    
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      margin: {
        top: '50px',
        right: '50px',
        bottom: '50px',
        left: '50px'
      },
      printBackground: true
    });
    
    console.log(`PDF created at ${pdfPath}`);
    
    // Close browser and clean up HTML file
    await browser.close();
    browser = null;
    fs.unlinkSync(tempHtmlPath);
    tempHtmlPath = null;
    
    // Generate filename
    const safeTaskTypes = taskTypes.join('-').toLowerCase().replace(/\s+/g, '-');
    const safeLanguages = languages.join('-').toLowerCase().replace(/\s+/g, '-');
    const fileName = `${safeTaskTypes}_${safeLanguages}_${outputLanguage.toLowerCase()}.pdf`;
    
    // Send the PDF file
    res.download(pdfPath, fileName, (err) => {
      if (err) {
        console.error('Error sending PDF:', err);
        // If we haven't already sent a response
        if (!res.headersSent) {
          res.status(500).send('Error sending PDF');
        }
      }
      
      // Clean up the temporary file
      try {
        fs.unlinkSync(pdfPath);
        console.log('Temporary PDF file deleted');
      } catch (unlinkError) {
        console.error('Error removing temporary file:', unlinkError);
      }
    });
  } catch (error) {
    console.error('Error in /generate-from-pdf endpoint:', error);
    
    // Clean up resources
    if (browser) {
      try {
        await browser.close();
      } catch (closeBrowserError) {
        console.error('Error closing browser:', closeBrowserError);
      }
    }
    
    if (tempHtmlPath && fs.existsSync(tempHtmlPath)) {
      try {
        fs.unlinkSync(tempHtmlPath);
      } catch (unlinkError) {
        console.error('Error removing temporary HTML file:', unlinkError);
      }
    }
    
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        console.error('Error removing uploaded file:', unlinkError);
      }
    }
    
    // If we haven't already sent a response
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Error generating PDF', 
        details: error.message 
      });
    }
  }
});

// API endpoint to generate PDF from text pattern
app.post('/generate', async (req, res) => {
  let browser = null;
  let tempHtmlPath = null;
  
  try {
    const { pattern, taskTypes, languages, outputLanguage, withAlgorithmChart, withAppStructure, withGuiVisualization } = req.body;
    
    if (!pattern) {
      return res.status(400).json({ error: 'Pattern is required' });
    }
    
    if (!Array.isArray(taskTypes) || taskTypes.length === 0) {
      return res.status(400).json({ error: 'At least one task type must be selected' });
    }
    
    if (!Array.isArray(languages) || languages.length === 0) {
      return res.status(400).json({ error: 'At least one programming language must be selected' });
    }
    
    console.log(`Generating ${taskTypes.join(', ')} task using ${languages.join(', ')} (${outputLanguage})...`);
    
    // Format task types for the prompt
    const taskTypeString = formatTaskTypes(taskTypes);
    
    // Create language prompt based on number of languages
    const languagePrompt = languages.length > 1 
      ? `Create a multi-language solution using ${formatLanguagesForPrompt(languages)}. Include code examples or explanations for each language where appropriate. Focus on how the languages would interact or how the solution would differ between languages.`
      : `Implement the solution in ${languages[0]}.`;
    
    // Generate content using OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system", 
          content: `You are a programming task generator. Generate a programming task following the same structure as the provided pattern but with a different problem to solve. 
                   Format the output with Markdown headings (### for main sections, #### for subsections) and use proper Markdown formatting for lists and important points. 
                   The output should be in ${outputLanguage} language.`
        },
        {
          role: "user",
          content: `Pattern: ${pattern}\n\n
                  Create a new programming task following this pattern but for ${taskTypeString}.
                  ${languagePrompt}
                  The task should incorporate elements from all the specified types.
                  The task description should be written in ${outputLanguage}.`
        }
      ],
    });
    
    const generatedTask = completion.choices[0].message.content;
    console.log('Task generated successfully');
    
    // Generate visualizations if requested
    let algorithmChartCode = '';
    let appStructureCode = '';
    let guiVisualizationCode = '';
    
    if (withAlgorithmChart || withAppStructure) {
      // Get visualizations
      const visualizationsResponse = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system", 
            content: `You are an expert in creating Mermaid diagrams for software documentation. Generate clear, well-organized diagrams that visualize software components and algorithms.`
          },
          {
            role: "user",
            content: `Based on the following programming task description, create two Mermaid diagrams:
                    ${withAlgorithmChart ? '1. A flowchart showing the algorithm or main process flow described in the task.' : ''}
                    ${withAppStructure ? `${withAlgorithmChart ? '2' : '1'}. A class diagram or component diagram showing the structure of the application described in the task.` : ''}
                    
                    Only provide the Mermaid code blocks. Use the latest Mermaid syntax and make the diagrams visually clear.
                    
                    Task description: ${generatedTask}`
          }
        ],
      });
      
      const visualizationsContent = visualizationsResponse.choices[0].message.content;
      
      // Extract Mermaid code blocks
      if (withAlgorithmChart) {
        const algorithmChartMatch = visualizationsContent.match(/```mermaid\s*(flowchart|graph)[\s\S]*?```/i);
        algorithmChartCode = algorithmChartMatch ? algorithmChartMatch[0].replace(/```mermaid\s*|\s*```/g, '') : '';
      }
      
      if (withAppStructure) {
        const appStructureMatch = visualizationsContent.match(/```mermaid\s*(classDiagram|erDiagram|flowchart)[\s\S]*?```/i);
        appStructureCode = appStructureMatch ? appStructureMatch[0].replace(/```mermaid\s*|\s*```/g, '') : '';
        
        // If the first regex didn't match, try a more general one to find any other mermaid diagram
        if (!appStructureCode && withAppStructure) {
          const generalMatch = visualizationsContent.match(/```mermaid[\s\S]*?```/g);
          if (generalMatch && generalMatch.length > (withAlgorithmChart ? 1 : 0)) {
            appStructureCode = generalMatch[withAlgorithmChart ? 1 : 0].replace(/```mermaid\s*|\s*```/g, '');
          }
        }
      }
    }
    
    // Generate GUI visualization if requested
    if (withGuiVisualization) {
      // Get GUI visualization with improved prompting
      const guiVisualizationResponse = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system", 
            content: `You are an expert in creating UI mockups using Mermaid diagrams. 
            Generate simple, valid Mermaid code that represents the user interface described in the task.
            Follow these strict guidelines:
            1. Use flowchart LR or flowchart TD syntax for UI mockups
            2. Keep node IDs short and descriptive (e.g., btn1, input1)
            3. Avoid special characters in node text
            4. Use simple shapes like rectangles and rounded rectangles
            5. Use minimal styling to avoid syntax errors
            6. Ensure all nodes are properly connected
            7. Test your syntax mentally before providing it`
          },
          {
            role: "user",
            content: `Create a simple Mermaid diagram showing a mockup of the UI for the following task. 
            Focus on the main screens or components only. Use the flowchart syntax (NOT stateDiagram).
            
            Task description: ${generatedTask}`
          }
        ],
      });
      
      const guiVisualizationContent = guiVisualizationResponse.choices[0].message.content;
      
      // Extract Mermaid code block with improved regex matching
      const guiMatch = guiVisualizationContent.match(/```(?:mermaid)?\s*(flowchart[\s\S]*?)```/i);
      guiVisualizationCode = guiMatch ? guiMatch[1].trim() : '';
      
      // If no flowchart syntax is found, try to extract any mermaid code block
      if (!guiVisualizationCode) {
        const generalMatch = guiVisualizationContent.match(/```(?:mermaid)?\s*([\s\S]*?)```/i);
        guiVisualizationCode = generalMatch ? generalMatch[1].trim() : '';
      }
      
      // Validate that the code starts with flowchart and has basic structure
      if (guiVisualizationCode && !guiVisualizationCode.toLowerCase().startsWith('flowchart')) {
        guiVisualizationCode = 'flowchart TD\n    ' + guiVisualizationCode;
      }
      
      // If still empty or too short, create a simple fallback diagram
      if (!guiVisualizationCode || guiVisualizationCode.length < 20) {
        const appType = taskTypes.find(type => 
          type.includes('desktop') || type.includes('mobile') || type.includes('web')
        ) || 'application';
        
        guiVisualizationCode = `flowchart TD
        title["${appType.charAt(0).toUpperCase() + appType.slice(1)} UI Mockup"]
        mainScreen["Main Screen"]
        features["Features"]
        
        title --> mainScreen
        mainScreen --> features`;
      }
    }
    
    // Apply safety wrappers to mermaid code
    algorithmChartCode = algorithmChartCode ? createSafeMermaidWrapper(algorithmChartCode, "Algorithm") : '';
    appStructureCode = appStructureCode ? createSafeMermaidWrapper(appStructureCode, "App Structure") : '';
    guiVisualizationCode = guiVisualizationCode ? createSafeMermaidWrapper(guiVisualizationCode, "GUI") : '';
    
    // Include the diagrams in the HTML content
    const taskTypeDisplay = taskTypes.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(', ');
    const languagesDisplay = languages.map(l => l.toUpperCase()).join(', ');
    const htmlContent = generateHtml(generatedTask, languagesDisplay, taskTypeDisplay, outputLanguage, algorithmChartCode, appStructureCode, guiVisualizationCode);
    
    // Create a temporary HTML file
    tempHtmlPath = path.join(__dirname, `temp_${Date.now()}.html`);
    fs.writeFileSync(tempHtmlPath, htmlContent, 'utf8');
    
    // Generate PDF using Puppeteer
    console.log('Creating PDF with Puppeteer...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Set viewport size to ensure diagrams render properly
    await page.setViewport({
      width: 1200,
      height: 1600,
      deviceScaleFactor: 1,
    });
    
    await page.goto(`file://${tempHtmlPath}`, {
      waitUntil: 'networkidle0',
      timeout: 60000 // Increase timeout to allow Mermaid diagrams to render
    });
    
    // Wait for Mermaid diagrams to render
    try {
      await page.waitForFunction(() => {
        const diagrams = document.querySelectorAll('.mermaid');
        return Array.from(diagrams).every(diagram => diagram.querySelector('svg') || diagram.querySelector('.error-message'));
      }, { timeout: 10000 });
    } catch (e) {
      console.warn('Timeout waiting for diagrams to render, proceeding anyway');
    }
    
    // Additional wait to ensure complete rendering - using setTimeout instead of waitForTimeout
    await delay(2000);
    
    const pdfPath = path.join(__dirname, `temp_${Date.now()}.pdf`);
    
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      margin: {
        top: '50px',
        right: '50px',
        bottom: '50px',
        left: '50px'
      },
      printBackground: true
    });
    
    console.log(`PDF created at ${pdfPath}`);
    
    // Close browser and clean up HTML file
    await browser.close();
    browser = null;
    fs.unlinkSync(tempHtmlPath);
    tempHtmlPath = null;
    
    // Generate filename
    const safeTaskTypes = taskTypes.join('-').toLowerCase().replace(/\s+/g, '-');
    const safeLanguages = languages.join('-').toLowerCase().replace(/\s+/g, '-');
    const fileName = `${safeTaskTypes}_${safeLanguages}_${outputLanguage.toLowerCase()}.pdf`;
    
    // Send the PDF file
    res.download(pdfPath, fileName, (err) => {
      if (err) {
        console.error('Error sending PDF:', err);
        // If we haven't already sent a response
        if (!res.headersSent) {
          res.status(500).send('Error sending PDF');
        }
      }
      
      // Clean up the temporary file
      try {
        fs.unlinkSync(pdfPath);
        console.log('Temporary PDF file deleted');
      } catch (unlinkError) {
        console.error('Error removing temporary file:', unlinkError);
      }
    });
  } catch (error) {
    console.error('Error in /generate endpoint:', error);
    
    // Clean up resources
    if (browser) {
      try {
        await browser.close();
      } catch (closeBrowserError) {
        console.error('Error closing browser:', closeBrowserError);
      }
    }
    
    if (tempHtmlPath && fs.existsSync(tempHtmlPath)) {
      try {
        fs.unlinkSync(tempHtmlPath);
      } catch (unlinkError) {
        console.error('Error removing temporary HTML file:', unlinkError);
      }
    }
    
    // If we haven't already sent a response
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Error generating PDF', 
        details: error.message 
      });
    }
  }
});

// Format task types for natural language prompt
function formatTaskTypes(taskTypes) {
  if (taskTypes.length === 1) {
    return `a ${taskTypes[0]} program`;
  } else if (taskTypes.length === 2) {
    return `a program combining ${taskTypes[0]} and ${taskTypes[1]} elements`;
  } else {
    const lastType = taskTypes[taskTypes.length - 1];
    const otherTypes = taskTypes.slice(0, -1).join(', ');
    return `a program combining ${otherTypes}, and ${lastType} elements`;
  }
}

// HTML generation function with proper UTF-8 support and Mermaid diagrams
// Updated to use languagesDisplay instead of single language parameter
function generateHtml(content, languagesDisplay, taskType, outputLanguage, algorithmChartCode = '', appStructureCode = '', guiVisualizationCode = '') {
  // Convert markdown style headings and lists to HTML
  const htmlContent = content
    .replace(/### (.*)/g, '<h2>$1</h2>')
    .replace(/#### (.*)/g, '<h3>$1</h3>')
    .replace(/^\s*-\s+(.*)$/gm, '<li>$1</li>')
    .replace(/^\s*•\s+(.*)$/gm, '<li>$1</li>')
    .replace(/^\s*(\d+)\.\s+(.*)$/gm, '<li>$1. $2</li>');
  
  // Wrap bullet points and numbered lists in ul/ol tags
  let processedContent = '';
  let inList = false;
  const lines = htmlContent.split('\n');
  
  lines.forEach(line => {
    if (line.includes('<li>')) {
      if (!inList) {
        processedContent += '<ul>';
        inList = true;
      }
      processedContent += line;
    } else {
      if (inList) {
        processedContent += '</ul>';
        inList = false;
      }
      processedContent += line.trim() ? `<p>${line}</p>` : '';
    }
  });
  
  if (inList) {
    processedContent += '</ul>';
  }
  
  // Prepare diagram sections if charts are provided
  const diagramSections = [];
  
  if (algorithmChartCode) {
    diagramSections.push(`
    <div class="diagram-section">
      <h2>Algorithm Flowchart</h2>
      <div class="mermaid">
${algorithmChartCode}
      </div>
    </div>
    `);
  }
  
  if (appStructureCode) {
    diagramSections.push(`
    <div class="diagram-section">
      <h2>Application Structure</h2>
      <div class="mermaid">
${appStructureCode}
      </div>
    </div>
    `);
  }
  
  if (guiVisualizationCode) {
    diagramSections.push(`
    <div class="diagram-section">
      <h2>GUI Mockup</h2>
      <div class="mermaid">
${guiVisualizationCode}
      </div>
    </div>
    `);
  }
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${taskType} Programming Task</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.6.1/dist/mermaid.min.js"></script>
  <style>
    body {
      font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 20px;
      font-size: 12pt;
    }
    .header {
      text-align: center;
      margin-bottom: 20px;
      border-bottom: 1px solid #ddd;
      padding-bottom: 20px;
    }
    h1 {
      font-size: 18pt;
      margin-bottom: 10px;
    }
    h2 {
      font-size: 16pt;
      margin-top: 20px;
    }
    h3 {
      font-size: 14pt;
    }
    .info {
      font-size: 12pt;
      margin-bottom: 5px;
    }
    .date {
      font-size: 10pt;
      font-style: italic;
    }
    ul, ol {
      margin-left: 20px;
      padding-left: 15px;
    }
    li {
      margin-bottom: 5px;
    }
    p {
      margin: 10px 0;
    }
    .footer {
      text-align: center;
      font-size: 10pt;
      margin-top: 30px;
      border-top: 1px solid #ddd;
      padding-top: 10px;
    }
    .diagram-section {
      margin-top: 30px;
      padding: 20px;
      background-color: #f8f8f8;
      border-radius: 5px;
      page-break-inside: avoid;
    }
    .diagram-section h2 {
      margin-top: 0;
      border-bottom: 1px solid #ddd;
      padding-bottom: 10px;
    }
    .mermaid {
      display: flex;
      justify-content: center;
      margin: 20px 0;
    }
    .error-message {
      color: #d9534f; 
      text-align: center; 
      padding: 20px; 
      border: 1px solid #d9534f; 
      border-radius: 5px; 
      margin: 20px;
    }
    @page {
      margin: 50px;
      size: A4;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${taskType} Programming Task</h1>
    <div class="info">Languages: ${languagesDisplay}</div>
    <div class="info">Instructions in: ${outputLanguage}</div>
    <div class="date">Generated: ${new Date().toLocaleDateString()}</div>
  </div>
  
  <div class="content">
    ${processedContent}
  </div>
  
  ${diagramSections.join('\n')}
  
  <div class="footer">
    Page <span class="pageNumber"></span>
  </div>
  
  <script>
    // Initialize Mermaid with error handling
    mermaid.initialize({ 
      startOnLoad: true,
      theme: 'default',
      flowchart: { 
        useMaxWidth: true, 
        htmlLabels: true,
        curve: 'basis'
      },
      securityLevel: 'loose',
      fontFamily: 'Arial',
      errorMessages: ['Syntax error in diagram'],
      logLevel: 'fatal'
    });
    
    // Add additional error handling
    document.addEventListener('DOMContentLoaded', function() {
      window.handleMermaidError = function() {
        const diagrams = document.querySelectorAll('.mermaid');
        diagrams.forEach(diagram => {
          if (!diagram.querySelector('svg')) {
            diagram.innerHTML = '<div class="error-message">Error rendering diagram. The visualization could not be generated correctly.</div>';
          }
        });
      };
      
      setTimeout(window.handleMermaidError, 3000);
    });

    // This script will be executed during PDF generation
    (function() {
      const pageElements = document.querySelectorAll('.pageNumber');
      pageElements.forEach(el => {
        el.textContent = '1'; // Puppeteer will handle proper pagination
      });
    })();
  </script>
</body>
</html>`;
}

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});

// Handle server errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection:', reason);
  console.error('Promise:', promise);
});