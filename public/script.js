document.addEventListener('DOMContentLoaded', () => {
    // Initialize Mermaid for diagrams
    mermaid.initialize({
      startOnLoad: true,
      theme: 'default',
      securityLevel: 'loose',
      fontFamily: 'Arial'
    });
    
    const generateBtn = document.getElementById('generateBtn');
    const patternInput = document.getElementById('pattern');
    const taskTypeCheckboxes = document.querySelectorAll('.task-type-checkbox');
    const selectedTaskTypesDiv = document.getElementById('selected-task-types');
    const addCustomTypeBtn = document.getElementById('add-custom-type');
    const customTaskTypeInput = document.getElementById('custom-task-type');
    const languageSelect = document.getElementById('language');
    const outputLanguageSelect = document.getElementById('outputLanguage');
    const loadingDiv = document.getElementById('loading');
    const loadingText = document.getElementById('loadingText');
    const errorDiv = document.getElementById('error');
    const pdfFileInput = document.getElementById('pdfFile');
    const textTabBtn = document.getElementById('textTabBtn');
    const pdfTabBtn = document.getElementById('pdfTabBtn');
    const textTab = document.getElementById('textTab');
    const pdfTab = document.getElementById('pdfTab');
    const includeAlgorithmChart = document.getElementById('includeAlgorithmChart');
    const includeAppStructure = document.getElementById('includeAppStructure');
    const visualizationPreview = document.getElementById('visualizationPreview');
    const vizTabs = document.querySelectorAll('.viz-tab');
    const algorithmChartPreview = document.getElementById('algorithmChartPreview');
    const appStructurePreview = document.getElementById('appStructurePreview');
    
    // Set up task type selection
    let selectedTaskTypes = [];
    
    // Function to update the selected task types display
    function updateSelectedTaskTypes() {
      if (selectedTaskTypes.length === 0) {
        selectedTaskTypesDiv.textContent = 'No task types selected';
        return;
      }
      
      selectedTaskTypesDiv.innerHTML = '';
      selectedTaskTypes.forEach(type => {
        const tag = document.createElement('span');
        tag.classList.add('task-type-tag');
        tag.innerHTML = `${type} <span class="remove-tag" data-type="${type}">✕</span>`;
        selectedTaskTypesDiv.appendChild(tag);
      });
      
      // Add event listeners for tag removal
      document.querySelectorAll('.remove-tag').forEach(el => {
        el.addEventListener('click', function() {
          const typeToRemove = this.getAttribute('data-type');
          removeTaskType(typeToRemove);
          
          // If it's one of our checkboxes, uncheck it
          document.querySelectorAll('.task-type-checkbox').forEach(checkbox => {
            if (checkbox.value === typeToRemove) {
              checkbox.checked = false;
            }
          });
        });
      });
    }
    
    // Add task type to the selection
    function addTaskType(type) {
      if (type && !selectedTaskTypes.includes(type)) {
        selectedTaskTypes.push(type);
        updateSelectedTaskTypes();
      }
    }
    
    // Remove task type from the selection
    function removeTaskType(type) {
      selectedTaskTypes = selectedTaskTypes.filter(t => t !== type);
      updateSelectedTaskTypes();
    }
    
    // Event listeners for checkboxes
    taskTypeCheckboxes.forEach(checkbox => {
      checkbox.addEventListener('change', function() {
        if (this.checked) {
          addTaskType(this.value);
        } else {
          removeTaskType(this.value);
        }
      });
    });
    
    // Event listener for adding custom task type
    addCustomTypeBtn.addEventListener('click', () => {
      const customType = customTaskTypeInput.value.trim();
      if (customType) {
        addTaskType(customType);
        customTaskTypeInput.value = '';
        
        // Optionally create a new checkbox for this task type
        const typesGrid = document.querySelector('.task-types-grid');
        const uniqueId = `type-${customType.toLowerCase().replace(/\s+/g, '-')}`;
        
        // Only add if it doesn't exist already
        if (!document.getElementById(uniqueId)) {
          const newItem = document.createElement('div');
          newItem.className = 'task-type-item';
          newItem.innerHTML = `
            <input type="checkbox" id="${uniqueId}" value="${customType}" class="task-type-checkbox" checked>
            <label for="${uniqueId}">${customType}</label>
          `;
          typesGrid.appendChild(newItem);
          
          // Add event listener to the new checkbox
          const newCheckbox = document.getElementById(uniqueId);
          newCheckbox.addEventListener('change', function() {
            if (this.checked) {
              addTaskType(this.value);
            } else {
              removeTaskType(this.value);
            }
          });
        }
      }
    });
    
    // Allow adding custom task type with Enter key
    customTaskTypeInput.addEventListener('keypress', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addCustomTypeBtn.click();
      }
    });
    
    // Tab switching for input type
    textTabBtn.addEventListener('click', () => {
      textTabBtn.classList.add('active');
      pdfTabBtn.classList.remove('active');
      textTab.classList.remove('hidden');
      pdfTab.classList.add('hidden');
    });
    
    pdfTabBtn.addEventListener('click', () => {
      pdfTabBtn.classList.add('active');
      textTabBtn.classList.remove('active');
      pdfTab.classList.remove('hidden');
      textTab.classList.add('hidden');
    });
    
    // Tab switching for visualization preview
    vizTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        // Remove active class from all tabs
        vizTabs.forEach(t => t.classList.remove('active'));
        
        // Add active class to clicked tab
        tab.classList.add('active');
        
        // Show corresponding content
        const tabId = tab.getAttribute('data-tab');
        
        if (tabId === 'algorithmChart') {
          algorithmChartPreview.classList.remove('hidden');
          appStructurePreview.classList.add('hidden');
        } else {
          algorithmChartPreview.classList.add('hidden');
          appStructurePreview.classList.remove('hidden');
        }
      });
    });
    
    // Generate PDF
    generateBtn.addEventListener('click', async () => {
      const taskTypes = selectedTaskTypes;
      const language = languageSelect.value;
      const outputLanguage = outputLanguageSelect.value;
      const withAlgorithmChart = includeAlgorithmChart.checked;
      const withAppStructure = includeAppStructure.checked;
      
      if (taskTypes.length === 0) {
        alert('Please select at least one task type.');
        return;
      }
      
      // Hide error and show loading
      errorDiv.classList.add('hidden');
      loadingDiv.classList.remove('hidden');
      visualizationPreview.classList.add('hidden');
      generateBtn.disabled = true;
      
      try {
        let isPdfMode = pdfTabBtn.classList.contains('active');
        let response;
        
        if (isPdfMode) {
          // PDF Mode - Upload and process the PDF
          const file = pdfFileInput.files[0];
          if (!file) {
            alert('Please select a PDF file first.');
            loadingDiv.classList.add('hidden');
            generateBtn.disabled = false;
            return;
          }
          
          loadingText.textContent = "Extracting text from PDF...";
          
          // Create a FormData object to send the file
          const formData = new FormData();
          formData.append('pdfFile', file);
          formData.append('taskTypes', JSON.stringify(taskTypes));
          formData.append('language', language);
          formData.append('outputLanguage', outputLanguage);
          formData.append('withAlgorithmChart', withAlgorithmChart);
          formData.append('withAppStructure', withAppStructure);
          
          response = await fetch('/generate-from-pdf', {
            method: 'POST',
            body: formData
          });
        } else {
          // Text Mode - Use the text input
          const pattern = patternInput.value.trim();
          
          if (!pattern) {
            alert('Please provide a pattern template.');
            loadingDiv.classList.add('hidden');
            generateBtn.disabled = false;
            return;
          }
          
          loadingText.textContent = "Generating your task PDF...";
          
          response = await fetch('/generate', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
              pattern, 
              taskTypes, 
              language, 
              outputLanguage,
              withAlgorithmChart,
              withAppStructure
            })
          });
        }
        
        if (!response.ok) {
          throw new Error('Failed to generate PDF');
        }
        
        // Check if the response includes visualization data
        const contentType = response.headers.get('Content-Type');
        
        if (contentType && contentType.includes('application/json')) {
          // This is a visualization response
          const data = await response.json();
          
          // Display the visualizations
          showVisualizations(data.algorithmChart, data.appStructure);
        } else {
          // This is a PDF file response
          const blob = await response.blob();
          downloadPdf(blob, taskTypes.join('-'), language, outputLanguage);
        }
        
      } catch (error) {
        console.error('Error:', error);
        errorDiv.classList.remove('hidden');
      } finally {
        loadingDiv.classList.add('hidden');
        generateBtn.disabled = false;
      }
    });
    
    function showVisualizations(algorithmChartCode, appStructureCode) {
      visualizationPreview.classList.remove('hidden');
      
      // Update algorithm chart diagram
      if (algorithmChartCode) {
        const algorithmDiagramContainer = algorithmChartPreview.querySelector('.mermaid-diagram');
        algorithmDiagramContainer.innerHTML = algorithmChartCode;
        algorithmDiagramContainer.removeAttribute('data-processed');
        mermaid.init(undefined, algorithmDiagramContainer);
      } else {
        algorithmChartPreview.querySelector('.mermaid-diagram').innerHTML = 'No algorithm chart generated';
      }
      
      // Update app structure diagram
      if (appStructureCode) {
        const appStructureContainer = appStructurePreview.querySelector('.mermaid-diagram');
        appStructureContainer.innerHTML = appStructureCode;
        appStructureContainer.removeAttribute('data-processed');
        mermaid.init(undefined, appStructureContainer);
      } else {
        appStructurePreview.querySelector('.mermaid-diagram').innerHTML = 'No app structure diagram generated';
      }
    }
    
    function downloadPdf(blob, taskType, language, outputLanguage) {
      // Create a link to download the PDF
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `${taskType}_${language}_${outputLanguage.toLowerCase()}.pdf`;
      
      // Append to the document and trigger download
      document.body.appendChild(a);
      a.click();
      
      // Clean up
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }
  });