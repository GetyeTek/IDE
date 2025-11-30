
import { selectNextWord, processReview, createNewSrsWord } from './srs.js';
import * as api from './api.js';
import * as movie from './movie.js';
import * as quiz from './quiz.js';
import * as chat from './chat.js';
import * as ui from './ui.js';
import * as deckManager from './deckManager.js';
import * as agent from './agent.js';
import * as deckViewer from './deckViewer.js';
import * as wotd from './wotd.js';
import * as home from './home.js';
import * as scoring from './scoring.js';
import * as backupManager from './backupManager.js';

document.addEventListener('DOMContentLoaded', () => {
    let genAI; // This will hold the initialized Gemini client
    // --- State Management ---
    let decks = [];
    let folders = []; // For the new folder system

    // State for the new Decks screen view
    let currentDeckView = 'all'; // 'all', 'folders', or 'folder_{id}'
    let activeFolderId = null;
    let currentMoveTargetFolderId = null; // For the "Move To..." modal
    let proficiencyLog = [];
    let currentChartFilterDays = 0; // 0 for "All"
    
    
    // API and Chat State
    
    let supabaseUrl = '';
    let supabaseAnonKey = '';
    let currentApiKeys = {}; // Declare at module level

    
    let isCseScriptLoaded = false; // NEW: Flag for Google CSE script
    let automationSettings = {}; // For the new AI settings
    let apiSettings = {}; // For the new master API toggles
    let deckViewMode = 'flashcard';
    let defaultDeckViewMode = 'flashcard'; // NEW: For the settings
    let studySettings = {}; // NEW: For the "Study Experience" settings
    let pressTimer = null;
    let isSelectionMode = { decks: false, history: false, wotd: false };
    let selectedIds = { decks: new Set(), history: new Set(), wotd: new Set() };
    let aboutTapCount = 0;
    let aboutTapTimer = null;
    let isErudaActive = false;
let longPressJustFinished = false; // THE FIX: To prevent click after long press
    let settingsTapCount = 0;
    let settingsTapTimer = null;
    let imageSearchContext = { type: null, id: null, wordText: null }; // For the new search modal
    let selectedImageUrl = null; // For the confirmation step
    let currentBlacklistContext = null; // For the new blacklist modal

//public deck exploration
let publicDecks = [];
    let currentPublicDeck = null;
    let publicDecksSortAndFilter = {
        sort: 'date_desc',
        filter: { type: 'type_all', size: null }
    };

    // --- NEW: State for Image Search Pagination ---
    let imageSearchResults = [];
    let imageSearchCurrentPage = 1;
    const IMAGES_PER_PAGE = 10;

// NEW: Scoped View State Management
    let viewStates = {};
    const DEFAULT_VIEW_STATE = { 
        sort: 'date_desc', 
        filter: { type: 'type_all', size: null }, 
        viewMode: 'grid' 
    };

    function loadViewStates() {
        const statesJSON = localStorage.getItem('wordwiseViewStates');
        viewStates = statesJSON ? JSON.parse(statesJSON) : {};
    }
    function saveViewStates() {
        localStorage.setItem('wordwiseViewStates', JSON.stringify(viewStates));
    }

    // This is the new brain: it gets the settings for the CURRENTLY active view.
    function getCurrentViewState() {
        // If there's no state for the current view (e.g., first time visiting a folder), create a default one.
        if (!viewStates[currentDeckView]) {
            // Use the 'all' view's settings as a starting point if it exists, otherwise use the hardcoded default.
            viewStates[currentDeckView] = { ...(viewStates['all'] || DEFAULT_VIEW_STATE) };
        }
        return viewStates[currentDeckView];
    }

    // --- A single, comprehensive DOM elements object ---
    const DOM = {
        mainAppContainer: document.getElementById('main-app-container'),
        allModals: document.querySelectorAll('.screen-modal'),
        screens: {
            home: document.getElementById('home-screen'),
            decks: document.getElementById('decks-screen'),
            viewDeck: document.getElementById('view-deck-screen'),
            settings: document.getElementById('settings-screen'),
            chat: document.getElementById('chat-screen'),
            createDeck: document.getElementById('create-deck-screen'),
            richCardEditor: document.getElementById('rich-card-editor-screen'), // NEW
            addWordsManually: document.getElementById('add-words-manually-screen'),
            testType: document.getElementById('test-type-screen'),
            deckType: document.getElementById('deck-type-screen'),
            quiz: document.getElementById('quiz-screen'),
            mcQuiz: document.getElementById('mc-quiz-screen'),
            quizReview: document.getElementById('quiz-review-screen'),
            quizHistory: document.getElementById('quiz-history-screen'),
            wotdLog: document.getElementById('wotd-log-screen'),
            proficiencyStats: document.getElementById('proficiency-stats-screen'),
            movieList: document.getElementById('movie-list-screen'),
            addMovie: document.getElementById('add-movie-modal'),
            movieDetail: document.getElementById('movie-detail-screen'),
            moviePlayer: document.getElementById('movie-player-screen'),
            videoPlayer: document.getElementById('video-player-screen'),
            importConfirm: document.getElementById('import-confirm-modal'),
            imageSearch: document.getElementById('image-search-modal'),
            imageConfirmOverlay: document.getElementById('image-confirm-overlay'), // THE FIX
editMovie: document.getElementById('edit-movie-modal'),
            renameTitles: document.getElementById('rename-titles-modal'),
            confirmAction: document.getElementById('confirm-action-modal'), // THE FIX
            aiAutomation: document.getElementById('ai-automation-modal'), // ADD THIS LINE
            blacklist: document.getElementById('blacklist-modal'),
            blacklistContext: document.getElementById('blacklist-context-modal'), // NEW
            simpleWordEntry: document.getElementById('simple-word-entry-screen'),
        },
               navLinks: { 
                home: document.getElementById('nav-home'), 
                decks: document.getElementById('nav-decks'),
                chat: document.getElementById('nav-chat'),
                movie: document.getElementById('nav-movie'),
                settings: document.getElementById('nav-settings' )
            },
            // --- NEW: Sidebar and Deck Screen Elements ---
            deckSidebar: document.getElementById('deck-sidebar'),
            deckSidebarOverlay: document.getElementById('deck-sidebar-overlay'),
            decksScreenTitle: document.getElementById('decks-screen-title'),
            deckViewContainer: document.getElementById('deck-view-container'),
            deckViews: {
                all: document.getElementById('all-decks-view'),
                folders: document.getElementById('folders-main-view'),
                singleFolder: document.getElementById('single-folder-view'),
            },
            folderListView: document.getElementById('folder-list-view'),
            folderGridView: document.getElementById('folder-grid-view'),
            viewToggleBtn: document.getElementById('view-toggle-btn'),
            folderViewAreaTitle: document.getElementById('folder-view-area-title'),
            // --- NEW: Deck Display Mode Elements ---
            deckDisplayModeToggleBtn: document.getElementById('deck-display-mode-toggle-btn'),
            allDecksGridViewContainer: document.getElementById('all-decks-grid-view-container'),
            allDecksListViewContainer: document.getElementById('all-decks-list-view-container'),
            // --- NEW: Folder Management Modal Elements ---
            manageFoldersScreen: document.getElementById('manage-folders-screen'),
            addEditFolderModal: document.getElementById('add-edit-folder-modal'),
            moveToFolderModal: document.getElementById('move-to-folder-modal'),
            moveToFolderList: document.getElementById('move-to-folder-list'),
            manageFoldersList: document.getElementById('manage-folders-list'),
            folderModalTitle: document.getElementById('folder-modal-title'),
            folderNameInput: document.getElementById('folder-name-input'),
            folderColorPicker: document.querySelector('.folder-color-picker'),
            saveFolderBtn: document.getElementById('save-folder-btn'),
        // --- Specific element references ---
        mainSearchInput: document.getElementById('main-search-input'),
        searchResultsContainer: document.getElementById('search-results-container'),
        defaultDecksView: document.getElementById('default-decks-view'),
        
        // Deck Manager Elements
        deckTitleInput: document.getElementById('deck-title-input'),
        deckDescriptionInput: document.getElementById('deck-description-input'),
        manualWordsTextarea: document.getElementById('manual-words-textarea'),
        addManuallyBtnText: document.getElementById('add-manually-btn').querySelector('.list-option-text'),
        importFromListBtnText: document.getElementById('import-from-list-btn').querySelector('.list-option-text'),
        createDeckModalTitle: document.getElementById('create-deck-modal-title'),
        createDeckSubmitBtn: document.getElementById('create-deck-submit-btn'),
                deleteDeckBtn: document.getElementById('delete-deck-btn'),
        backendSettingsWrapper: document.getElementById('backend-settings-wrapper'),
    };
    // Derived collections for convenience
    // Add the new modals to the main screens object
    DOM.screens.addDeckSourceChoice = document.getElementById('add-deck-source-choice-modal');
    DOM.screens.exploreList = document.getElementById('explore-list-screen');
    DOM.screens.exploreDetail = document.getElementById('explore-detail-screen');
    DOM.screens.importConflict = document.getElementById('import-conflict-modal');

    DOM.allMainScreens = [DOM.screens.home, DOM.screens.decks, DOM.screens.viewDeck, DOM.screens.settings, DOM.screens.chat, DOM.screens.movieList];
    DOM.fullChatElements = { appContainer: document.getElementById('full-chat-app-container'), sidebarToggle: document.getElementById('chat-sidebar-toggle'), sidebarOverlay: document.getElementById('chat-sidebar-overlay'), historyList: document.getElementById('chat-history-list'), logArea: document.getElementById('main-chat-log-area'), textarea: document.getElementById('main-chat-textarea'), sendBtn: document.getElementById('main-send-chat-btn'), newChatBtn: document.getElementById('new-chat-btn'), optionsBtn: document.getElementById('options-btn'), optionsPopover: document.getElementById('options-popover'), modelIndicator: document.getElementById('chat-model-indicator'), deleteChatBtn: document.getElementById('delete-chat-btn'), exitChatBtn: document.getElementById('exit-chat-btn') };

    // --- API Key & Theme Management ---
    function saveCredentialToStorage(key, name) {
        localStorage.setItem(`wordwise${name}`, key);
    }
    function loadAutomationSettings() {
        const settingsJSON = localStorage.getItem('wordwiseAutomationSettings');
        const defaultSettings = {
            enableImageAutomation: true,
            enableAutoDefinitions: true,
            imageAutomationDeckTypes: { Vocabulary: true, Expressions: true, Subtitle: true, blacklist: [] },
            autoDefinitionsDeckTypes: { Vocabulary: true, Expressions: true, Subtitle: true, blacklist: [] }
        };
        automationSettings = settingsJSON ? { ...defaultSettings, ...JSON.parse(settingsJSON) } : defaultSettings;
       
    }

function syncAiAutomationModalUI() {
        if (!DOM.screens.aiAutomation) return;

        // Sync master toggles
        DOM.screens.aiAutomation.querySelector('.master-automation-toggle[data-feature-key="enableImageAutomation"]').checked = automationSettings.enableImageAutomation;
        DOM.screens.aiAutomation.querySelector('.master-automation-toggle[data-feature-key="enableAutoDefinitions"]').checked = automationSettings.enableAutoDefinitions;
        
        // Sync deck type buttons for each feature
        const featureCards = DOM.screens.aiAutomation.querySelectorAll('.automation-card[data-feature-key]');
        featureCards.forEach(card => {
            const featureKey = card.dataset.featureKey;
            const typeSettings = automationSettings[featureKey];

            card.querySelectorAll('.deck-type-btn').forEach(btn => {
                const deckType = btn.dataset.type;
                btn.classList.toggle('active', typeSettings[deckType] === true);
            });
        });
    }

    function loadStudySettings() {
        const settingsJSON = localStorage.getItem('wordwiseStudySettings');
        const defaultSettings = {
            prioritizeSrs: true,
            reverseFlashcards: false,
        };
        
        // This ensures saved settings (like reverseFlashcards: true) will override the defaults.
        const loadedSettings = settingsJSON ? JSON.parse(settingsJSON) : {};
        studySettings = { ...defaultSettings, ...loadedSettings };

        // Sync UI toggles with the final, merged settings
        document.getElementById('prioritize-srs-toggle').checked = studySettings.prioritizeSrs;
        document.getElementById('reverse-flashcards-toggle').checked = studySettings.reverseFlashcards;
    }

    function saveStudySettings() {
        localStorage.setItem('wordwiseStudySettings', JSON.stringify(studySettings));
    }

    function saveAutomationSettings() {
        localStorage.setItem('wordwiseAutomationSettings', JSON.stringify(automationSettings));
    }

    // --- NEW: API Settings Management ---
    function loadApiSettings() {
        const settingsJSON = localStorage.getItem('wordwiseApiSettings');
        const defaultSettings = {
            groq: true,
            gemini: true,
            merriamWebster: true,
            publicDictionary: true, // --- THIS IS THE NEW LINE ---
            images: true // A single toggle for both Unsplash and Google
        };
        apiSettings = settingsJSON ? { ...defaultSettings, ...JSON.parse(settingsJSON) } : defaultSettings;
    }

    function saveApiSettings() {
        localStorage.setItem('wordwiseApiSettings', JSON.stringify(apiSettings));
    }

    function syncApiSettingsUI() {
        document.getElementById('groq-api-toggle').checked = apiSettings.groq;
        document.getElementById('gemini-api-toggle').checked = apiSettings.gemini;
        document.getElementById('mw-api-toggle').checked = apiSettings.merriamWebster;
        document.getElementById('public-dictionary-api-toggle').checked = apiSettings.publicDictionary; // --- THIS IS THE NEW LINE ---
        document.getElementById('image-api-toggle').checked = apiSettings.images;
    }
    // --- END: API Settings Management ---

    function loadApiKeysFromStorage() {
        // All external API keys are managed by the Supabase proxy.
        // We only need to load the Supabase credentials on the client.
        supabaseUrl = localStorage.getItem('wordwiseSupabaseUrl') || '';
        supabaseAnonKey = localStorage.getItem('wordwiseSupabaseAnonKey') || '';
        const supabaseUrlInput = document.getElementById('supabase-url-input');
        const supabaseAnonKeyInput = document.getElementById('supabase-anon-key-input');
        if(supabaseUrlInput) supabaseUrlInput.value = supabaseUrl;
        if(supabaseAnonKeyInput) supabaseAnonKeyInput.value = supabaseAnonKey;
    }
    function setDefaultDeckView(mode) {
        defaultDeckViewMode = mode;
        localStorage.setItem('wordwiseDefaultDeckView', mode);

        // Update the UI label in settings
        const label = document.getElementById('current-default-view-label');
        if (label) {
            label.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
        }

        // Update the active button in the selector
        document.querySelectorAll('#default-view-options-container .view-mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.id.endsWith(mode));
        });
    }

    function applySavedTheme() {
        const savedTheme = localStorage.getItem('wordwiseTheme');
        const themeIcon = document.getElementById('theme-icon');
        if (savedTheme === 'dark') {
            document.documentElement.classList.add('dark-theme');
            if (themeIcon) themeIcon.className = 'ph ph-sun';
        } else {
            document.documentElement.classList.remove('dark-theme');
            if (themeIcon) themeIcon.className = 'ph ph-moon';
        }
    }

    // --- Data Persistence ---
function loadDecksFromStorage() {
    const decksJSON = localStorage.getItem('wordwiseDecks');
    let loadedDecks = decksJSON ? JSON.parse(decksJSON) : [];
    let needsSave = false;

    // --- Logic for the Special "Word of the Day" Deck ---
    const WOTD_DECK_ID = 'word_of_the_day_deck';
    const defaultWotdImage = 'https://images.unsplash.com/photo-1457369804613-52c61a468e7d?q=80&w=2070&auto=format&fit=crop';
    let wotdDeck = loadedDecks.find(d => d.id === WOTD_DECK_ID);

    if (!wotdDeck) {
        // Case 1: Deck doesn't exist at all (new user). Create it with the image.
        console.log("📚 [WotD Deck] 'Word of the Day' deck not found. Creating it for the first time.");
        wotdDeck = {
            id: WOTD_DECK_ID,
            title: "Word of the Day",
            description: "A collection of daily words from Merriam Webster.",
            words: [],
            type: 'Vocabulary',
            isSpecial: true,
            imageUrl: defaultWotdImage,
            createdAt: new Date().toISOString()
        };
        loadedDecks.unshift(wotdDeck);
        needsSave = true;
    } else if (!wotdDeck.imageUrl) {
        // --- THE FIX ---
        // Case 2: Deck exists, but has no image (existing user). Add the default image.
        console.log("🖼️ [WotD Deck] Found existing 'Word of the Day' deck without an image. Assigning default cover.");
        wotdDeck.imageUrl = defaultWotdImage;
        needsSave = true;
    }

    // --- Data Migration Logic for Word Structure & FOLDERS ---
    loadedDecks.forEach(deck => {
        // NEW: Add folderId if it doesn't exist
        if (!deck.hasOwnProperty('folderId')) {
            deck.folderId = null;
            needsSave = true;
        }

        if (deck.words && deck.words.length > 0) {
            let deckWasMigrated = false;
            deck.words = deck.words.map(word => {
                if (typeof word === 'string' || !word.hasOwnProperty('definitions')) {
                    deckWasMigrated = true;
                    const wordText = typeof word === 'string' ? word : word.text;
                    const newWord = {
                        text: wordText,
                        masteryLevel: word.masteryLevel || 0,
                        lastSeen: word.lastSeen || null,
                        imageUrl: null,
                        isImageProvisional: true,
                        definitions: {
                            flashcard: null,
                            detailed: null,
                            gemini: null,
                            mwDictionary: null, // Add new property
                            mwThesaurus: null   // Add new property
                        }
                    };
                    return newWord;
                }

                // Migration for existing objects that don't have the new properties
                if (!word.definitions.mwDictionary) {
                    word.definitions.mwDictionary = null;
                    deckWasMigrated = true;
                }
                if (!word.definitions.mwThesaurus) {
                    word.definitions.mwThesaurus = null;
                    deckWasMigrated = true;
                }
                
                return word;
            });

            if (deckWasMigrated) {
                needsSave = true;
            }
        }
    });

    decks = loadedDecks;
    if (needsSave) {
        console.log("💾 [Storage] Data migration or updates occurred. Saving changes to localStorage.");
        saveDecksToStorage();
    }
}
function loadFoldersFromStorage() {
    const foldersJSON = localStorage.getItem('wordwiseFolders');
    folders = foldersJSON ? JSON.parse(foldersJSON) : [];

    let needsSave = false;
    // Migration: Add parentId to existing folders
    folders.forEach(folder => {
        if (!folder.hasOwnProperty('parentId')) {
            folder.parentId = null; // Assign as top-level by default
            needsSave = true;
        }
    });

    // Add mock folders if none exist for new users
    if (folders.length === 0) {
        console.log("No folders found. Creating a default folder for demonstration.");
        folders = [
            { id: 'f1', name: 'English', color: '#3b82f6', parentId: null }
        ];
        needsSave = true;
    }

    if (needsSave) {
        saveFoldersToStorage();
    }
}
function saveFoldersToStorage() {
    localStorage.setItem('wordwiseFolders', JSON.stringify(folders));
}

function loadProficiencyLog() {
    const logJSON = localStorage.getItem('wordwiseProficiencyLog');
    proficiencyLog = logJSON ? JSON.parse(logJSON) : [];
}

function saveFoldersToStorage() {
    localStorage.setItem('wordwiseFolders', JSON.stringify(folders));
}

// --- NEW HELPER FUNCTION FOR VIEW STATE PERSISTENCE ---
function setDeckView(view, folderId = null) {
    currentDeckView = view;
    activeFolderId = folderId;
    localStorage.setItem('wordwiseCurrentDeckView', currentDeckView);
    localStorage.setItem('wordwiseActiveFolderId', activeFolderId || 'null'); // Store null as a string
}

function saveProficiencyLog() {
    localStorage.setItem('wordwiseProficiencyLog', JSON.stringify(proficiencyLog));
}

// --- NEW: Folder CRUD Functions ---
let currentEditFolderId = null;
let currentParentFolderId = null; // For creating nested folders
const FOLDER_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f97316', '#8b5cf6', '#e879f9'];

function openAddEditFolderModal(folderToEdit = null, parentId = null) {
    currentEditFolderId = folderToEdit ? folderToEdit.id : null;
    currentParentFolderId = folderToEdit ? folderToEdit.parentId : parentId; // Store the parentId
    
    if (folderToEdit) {
        DOM.folderModalTitle.textContent = "Edit Folder";
        DOM.folderNameInput.value = folderToEdit.name;
        DOM.saveFolderBtn.textContent = "Save Changes";
    } else {
        DOM.folderModalTitle.textContent = "New Folder";
        DOM.folderNameInput.value = "";
        DOM.saveFolderBtn.textContent = "Create Folder";
    }
    
    // Render color swatches
    DOM.folderColorPicker.innerHTML = FOLDER_COLORS.map(color => `
        <div class="color-swatch" data-color="${color}" style="background-color: ${color};">
            <i class="ph-fill ph-check"></i>
        </div>
    `).join('');
    
    // Select the current color or the default
    const selectedColor = folderToEdit ? folderToEdit.color : FOLDER_COLORS[0];
    const activeSwatch = DOM.folderColorPicker.querySelector(`[data-color="${selectedColor}"]`);
    if (activeSwatch) {
        activeSwatch.classList.add('selected');
    }

    ui.showModal(DOM.addEditFolderModal);
}

function handleSaveFolder() {
    const name = DOM.folderNameInput.value.trim();
    if (!name) {
        ui.showToast("Please enter a folder name.", true);
        return;
    }

    // THE FIX: Check for duplicate folder names at the same level
    const isDuplicate = folders.some(f => 
        f.name.toLowerCase() === name.toLowerCase() && 
        f.parentId === currentParentFolderId && // Only check against siblings
        f.id !== currentEditFolderId // Allow saving with the same name when editing
    );

    if (isDuplicate) {
        ui.showToast(`A folder named "${name}" already exists here.`, true);
        return;
    }

    const selectedSwatch = DOM.folderColorPicker.querySelector('.color-swatch.selected');
    const color = selectedSwatch ? selectedSwatch.dataset.color : FOLDER_COLORS[0];

    if (currentEditFolderId) {
        // Editing existing folder
        const folder = folders.find(f => f.id === currentEditFolderId);
        if (folder) {
            folder.name = name;
            folder.color = color;
        }
    } else {
            // Creating new folder
    const newFolder = {
        id: `f_${Date.now()}`,
        name: name,
        color: color,
        parentId: currentParentFolderId // Add the parentId
    };
    folders.push(newFolder);
    }
    
    saveFoldersToStorage();
    renderDeckScreen(); // Re-render the main screen to show changes
    ui.closeAllModals(); // Close the add/edit modal
    
    // If the manage folders screen is the last active screen, re-render it
    if (lastActiveScreen === DOM.manageFoldersScreen || DOM.manageFoldersScreen.classList.contains('active')) {
        renderManageFoldersList();
        ui.showModal(DOM.manageFoldersScreen); // Re-open the manage screen
    }
}

function renderManageFoldersList() {
    DOM.manageFoldersList.innerHTML = '';
    if (folders.length === 0) {
        DOM.manageFoldersList.innerHTML = `<p class="no-results-message">You have no folders yet.</p>`;
        return;
    }

    folders.forEach(folder => {
        const deckCount = decks.filter(d => d.folderId === folder.id).length;
        DOM.manageFoldersList.innerHTML += `
            <div class="manage-folder-item" data-folder-id="${folder.id}">
                <i class="ph-fill ph-folder" style="color: ${folder.color}; font-size: 1.5rem;"></i>
                <div class="manage-folder-details">
                    <p class="manage-folder-name">${folder.name}</p>
                    <p class="manage-folder-meta">${deckCount} deck(s)</p>
                </div>
                <button class="folder-action-btn edit" title="Edit Folder"><i class="ph ph-pencil-simple"></i></button>
                <button class="folder-action-btn delete" title="Delete Folder"><i class="ph ph-trash"></i></button>
            </div>
        `;
    });
}

// --- NEW: Reusable Confirmation Modal Logic ---
    function showConfirmationDialog(options) {
        return new Promise((resolve) => {
            const {
                title = "Notice", // More neutral default
                message = "An action has occurred.",
                confirmText = "OK", // Default to a single "OK"
                cancelText = "Cancel",
                iconClass = "ph-fill ph-info-circle", // Default to an info icon
                confirmStyle = "primary", // can be "primary" or "danger"
                isAlert = false // If true, only the "confirm" button is shown
            } = options;

            // Populate the modal
            document.getElementById('confirm-dialog-title').textContent = title;
            document.getElementById('confirm-dialog-message').textContent = message;
            document.getElementById('confirm-dialog-confirm-btn').textContent = confirmText;
            document.getElementById('confirm-dialog-cancel-btn').textContent = cancelText;
            document.getElementById('confirm-dialog-icon').className = `${iconClass} confirm-dialog-icon`;

            const confirmBtn = document.getElementById('confirm-dialog-confirm-btn');
            if (confirmStyle === 'danger') {
                confirmBtn.style.backgroundColor = '#ef4444'; // Red color
            } else {
                confirmBtn.style.backgroundColor = ''; // Revert to default
            }

            DOM.screens.confirmAction.classList.add('active');

            const handleConfirm = () => {
                cleanup();
                resolve(true);
            };
            const handleCancel = () => {
                cleanup();
                resolve(false);
            };

            const confirmDialog = document.querySelector('#confirm-action-modal .confirm-dialog');
            const cancelBtn = document.getElementById('confirm-dialog-cancel-btn');
            const closeBtn = DOM.screens.confirmAction.querySelector('.close-modal-btn');
            
            // Use .once for automatic cleanup
            confirmBtn.addEventListener('click', handleConfirm, { once: true });
            cancelBtn.addEventListener('click', handleCancel, { once: true });
            closeBtn.addEventListener('click', handleCancel, { once: true });
            
            // Also resolve false if user clicks outside the dialog
            DOM.screens.confirmAction.addEventListener('click', (e) => {
                if (!confirmDialog.contains(e.target)) {
                    handleCancel();
                }
            }, { once: true });

            function cleanup() {
                DOM.screens.confirmAction.classList.remove('active');
                // Remove listeners just in case, though .once should handle it
                confirmBtn.removeEventListener('click', handleConfirm);
                cancelBtn.removeEventListener('click', handleCancel);
            }
        });
    }


async function handleDeleteFolder(folderId) {
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return;

    const confirmed = await showConfirmationDialog({
        title: `Delete Folder "${folder.name}"?`,
        message: "This will delete the folder and any sub-folders. All decks inside will be preserved and moved to the top level.",
        confirmText: "Delete Folder",
        confirmStyle: "danger",
        iconClass: "ph-fill ph-trash"
    });

    if (confirmed) {
        // Helper to find all nested child folder IDs
        const getAllChildFolderIds = (parentId) => {
            let childIds = [];
            const children = folders.filter(f => f.parentId === parentId);
            for (const child of children) {
                childIds.push(child.id);
                childIds = childIds.concat(getAllChildFolderIds(child.id));
            }
            return childIds;
        };

        const folderIdsToDelete = [folderId, ...getAllChildFolderIds(folderId)];
        const folderIdsToDeleteSet = new Set(folderIdsToDelete);

        // Un-file all decks within this folder and any of its sub-folders
        decks.forEach(deck => {
            if (deck.folderId && folderIdsToDeleteSet.has(deck.folderId)) {
                deck.folderId = null;
            }
        });
        
        // Remove the folder and all its descendants
        folders = folders.filter(f => !folderIdsToDeleteSet.has(f.id));
        
        saveDecksToStorage();
        saveFoldersToStorage();
        renderManageFoldersList(); // Re-render the list
        
        // THE FIX: Check if the deleted folder was the active one
        if (folderIdsToDeleteSet.has(activeFolderId)) {
            setDeckView('folders'); // Reset to a safe default and save state
        }

        renderDeckScreen(); // Re-render the main screen
    }
}
    function saveDecksToStorage() {
        localStorage.setItem('wordwiseDecks', JSON.stringify(decks));
    }












    // ========================================================================
// --- SRS (SPACED REPETITION SYSTEM) LOGIC ---
// ========================================================================

function calculateDeckStudyScore(deck) {
    if (!deck || !deck.words || !deck.words.length) return 0;
    const totalInterval = deck.words.reduce((sum, word) => sum + (word.interval || 0), 0);
    // Rough approximation: average interval of 30 days is "good progress"
    const targetAverage = 30;
    const percentage = (totalInterval / (deck.words.length * targetAverage)) * 100;
    return Math.min(100, Math.round(percentage));
}

function selectPrioritizedWordsForQuiz(deck, count = 10) {
    if (!deck || !deck.words || deck.words.length === 0) return [];
    
    let words = [];
    let tempDeck = { ...deck }; // shallow copy

    for (let i = 0; i < count; i++) {
        const nextWord = selectNextWord(tempDeck);
        if (nextWord) {
            words.push(nextWord.text);
            // Exclude this word from the next selection
            tempDeck.words = tempDeck.words.filter(w => w.text !== nextWord.text);
        } else {
            break; // No more words to select
        }
    }
    return words;
}
function renderSidebar() {
    const sidebar = DOM.deckSidebar;

    // Enhanced recursive helper to build the collapsible folder tree
    const buildFolderTreeHTML = (parentId, level) => {
        let html = '';
        const childrenFolders = folders.filter(f => f.parentId === parentId);

        childrenFolders.forEach(folder => {
            const grandchildren = folders.filter(f => f.parentId === folder.id);
            const hasChildren = grandchildren.length > 0;
            const deckCount = decks.filter(d => d.folderId === folder.id).length;
            const isActive = activeFolderId === folder.id;

            const caretHTML = hasChildren ? `<div class="caret-button"><i class="ph ph-caret-right"></i></div>` : `<div class="caret-button" style="width: 1.5rem;"></div>`;
            const childrenHTML = hasChildren ? `<div class="sub-folder-container">${buildFolderTreeHTML(folder.id, level + 1)}</div>` : '';

            // The 'expanded' class will be toggled by the event listener
            html += `
                <div class="folder-item-wrapper" data-folder-wrapper-id="${folder.id}">
                    <div class="sidebar-item sidebar-folder-item ${isActive ? 'active' : ''} ${hasChildren ? 'has-children' : ''}" data-nav-type="folder" data-folder-id="${folder.id}" style="padding-left: ${level * 10}px;">
                        ${caretHTML}
                        <i class="ph-fill ph-folder" style="color:${folder.color || 'var(--accent-primary)'};"></i>
                        <span class="sidebar-item-label">${folder.name}</span>
                        <span class="sidebar-item-count">${deckCount}</span>
                    </div>
                    ${childrenHTML}
                </div>
            `;
        });
        return html;
    };

    const folderItemsHTML = buildFolderTreeHTML(null, 0); // Start with top-level folders at level 0

    // Check if the main folder section should be expanded
    const isFolderSectionExpanded = sidebar.querySelector('.folder-section')?.classList.contains('expanded');

    sidebar.innerHTML = `
        <div class="sidebar-item ${currentDeckView === 'all' ? 'active' : ''}" data-nav-type="all">
            <i class="ph ph-files"></i>
            <span class="sidebar-item-label">All Decks</span>
            <span class="sidebar-item-count">${decks.length}</span>
        </div>
        <hr style="border-color: var(--border-color); margin: var(--space-md) 0;">
        <div class="folder-section ${isFolderSectionExpanded ? 'expanded' : ''}">
            <div class="sidebar-item folder-section-header has-children ${currentDeckView.startsWith('folder_') || currentDeckView === 'folders' ? 'active' : ''}" data-nav-type="folders">
                <div class="caret-button"><i class="ph ph-caret-right"></i></div>
                <i class="ph ph-folder"></i>
                <span class="sidebar-item-label">Folders</span>
                <span class="sidebar-item-count">${folders.filter(f => f.parentId === null).length}</span>
            </div>
            <div class="folder-section-content">
                ${folderItemsHTML}
                <button class="manage-folders-btn">Manage folders</button>
            </div>
        </div>
    `;
}
function renderDeckScreen() {
    renderSidebar(); // Update the sidebar first
    
    // Get the settings for the current view
    const state = getCurrentViewState();
    
    // Update the main view toggle button to reflect the current view's state
    const icon = DOM.deckDisplayModeToggleBtn.querySelector('i');
    icon.className = state.viewMode === 'list' ? 'ph ph-squares-four' : 'ph ph-list-bullets';
    DOM.deckDisplayModeToggleBtn.title = state.viewMode === 'list' ? 'Switch to Grid View' : 'Switch to List View';

    // Hide all main view containers
    Object.values(DOM.deckViews).forEach(view => view.classList.remove('active'));

    const viewType = currentDeckView.startsWith('folder_') ? 'single_folder' : currentDeckView;

    switch (viewType) {
        case 'all':
            DOM.deckViews.all.classList.add('active');
            const sortedDecks = getSortedAndFilteredItems(decks, state);
            const gridContainer = document.getElementById('all-decks-grid-container');
            const listContainer = document.getElementById('all-decks-list-container');
            const noResultsEl = document.getElementById('no-decks-filter-results');

            if (state.viewMode === 'list') {
                gridContainer.style.display = 'none';
                listContainer.style.display = 'block';
                ui.renderDecksList(sortedDecks, listContainer);
            } else {
                listContainer.style.display = 'none';
                gridContainer.style.display = 'grid';
                ui.renderDecks(sortedDecks, gridContainer);
            }

            if (sortedDecks.length === 0) {
                noResultsEl.style.display = 'block';
                gridContainer.style.display = 'none';
                listContainer.style.display = 'none';
            } else {
                noResultsEl.style.display = 'none';
            }
            break;

        case 'single_folder': {
            DOM.deckViews.singleFolder.classList.add('active');
            const navContainer = document.getElementById('folder-navigation-container');
            const itemsContainer = document.getElementById('single-folder-items-container');
            navContainer.innerHTML = '';
            itemsContainer.innerHTML = '';

            const currentFolder = folders.find(f => f.id === activeFolderId);
            const subFolders = folders.filter(f => f.parentId === activeFolderId);
            const decksInFolder = decks.filter(d => d.folderId === activeFolderId);
            
            const sortedSubFolders = getSortedAndFilteredItems(subFolders, state);
            const sortedDecksInFolder = getSortedAndFilteredItems(decksInFolder, state);

            // Render Back button
            if (currentFolder) {
                let backButtonTargetId = currentFolder.parentId || '';
                let backButtonNavType = currentFolder.parentId ? 'folder' : 'folders';
                let backButtonText = currentFolder.parentId ? `Back to ${folders.find(f => f.id === currentFolder.parentId).name}` : 'Back to Folders';
                
                navContainer.innerHTML = `<div class="folder-list-item" data-folder-id="${backButtonTargetId}" data-nav-type="${backButtonNavType}" style="cursor: pointer; margin: 0 var(--space-md) var(--space-md);"><i class="ph-fill ph-arrow-bend-up-left" style="font-size: 1.5rem;"></i><div class="folder-details"><p class="folder-name">${backButtonText}</p></div></div>`;
            }

            // Render items based on viewMode
            if (state.viewMode === 'list') {
                itemsContainer.className = ''; // Remove grid styles
                itemsContainer.style.padding = '0 var(--space-md)';
                
                let listHTML = '';
                sortedSubFolders.forEach(folder => {
                    listHTML += `<div class="folder-list-item" data-folder-id="${folder.id}"><i class="ph-fill ph-folder folder-icon" style="color:${folder.color || 'var(--accent-primary)'};"></i><div class="folder-details"><p class="folder-name">${folder.name}</p></div></div>`;
                });
                itemsContainer.innerHTML = listHTML;
                
                const decksListContainer = document.createElement('div');
                ui.renderDecksList(sortedDecksInFolder, decksListContainer);
                itemsContainer.innerHTML += decksListContainer.innerHTML;

            } else { // Grid View
                itemsContainer.className = 'decks-grid-container';
                itemsContainer.style.padding = '';
                
                let gridHTML = '';
                sortedSubFolders.forEach(folder => {
                    gridHTML += `<div class="folder-grid-card" data-folder-id="${folder.id}"><div class="folder-grid-preview"><i class="ph-fill ph-folder-open"></i></div><p class="folder-grid-name">${folder.name}</p></div>`;
                });
                itemsContainer.innerHTML = gridHTML;

                const tempDecksContainer = document.createElement('div');
                ui.renderDecks(sortedDecksInFolder, tempDecksContainer);
                itemsContainer.innerHTML += tempDecksContainer.innerHTML;
            }

            if (sortedSubFolders.length === 0 && sortedDecksInFolder.length === 0) {
                itemsContainer.innerHTML = `<div class="no-results-message"><p>This folder is empty.</p></div>`;
            }
            break;
        }

        case 'folders':
        default: {
            DOM.deckViews.folders.classList.add('active');
            
            // Sort top-level folders
            const parentFolders = folders.filter(f => f.parentId === null);
            const sortedParentFolders = getSortedAndFilteredItems(parentFolders, state);

            const folderListView = document.getElementById('folder-list-view');
            const folderGridView = document.getElementById('folder-grid-view').querySelector('.folders-carousel');
            folderListView.innerHTML = '';
            folderGridView.innerHTML = '';

            sortedParentFolders.forEach(f => {
                const deckCount = decks.filter(d => d.folderId === f.id).length;
                folderListView.innerHTML += `<div class="folder-list-item" data-folder-id="${f.id}"><i class="ph-fill ph-folder folder-icon" style="color:${f.color || 'var(--accent-primary)'};"></i><div class="folder-details"><p class="folder-name">${f.name}</p><p class="folder-meta">${deckCount} deck(s)</p></div></div>`;
                folderGridView.innerHTML += `<div class="folder-grid-card" data-folder-id="${f.id}"><div class="folder-grid-preview" style="color:${f.color || 'var(--accent-primary)'};"><i class="ph-fill ph-folder-open"></i></div><p class="folder-grid-name">${f.name}</p></div>`;
            });

            // Sort and render un-filed decks
            const unfiledDecks = decks.filter(d => !d.folderId);
            const sortedUnfiledDecks = getSortedAndFilteredItems(unfiledDecks, state);
            const unfiledGridContainer = document.getElementById('unfiled-decks-grid');
            const unfiledListContainer = document.getElementById('unfiled-decks-list');

            if (state.viewMode === 'list') {
                unfiledGridContainer.style.display = 'none';
                unfiledListContainer.style.display = 'block';
                ui.renderDecksList(sortedUnfiledDecks, unfiledListContainer);
            } else {
                unfiledListContainer.style.display = 'none';
                unfiledGridContainer.style.display = 'grid';
                ui.renderDecks(sortedUnfiledDecks, unfiledGridContainer);
            }
            break;
        }
    }
    updateDeckSortUI();
}

// --- NEW: LOCAL DECK SORT/FILTER LOGIC ---
        const deckSortToggleBtn = document.getElementById('deck-sort-toggle-btn');
        const deckSortPopover = document.getElementById('deck-sort-popover');

        const getSortedAndFilteredItems = (items, settings) => {
            let processedItems = [...items]; 
            const { sort, filter } = settings;
            const isDeck = items[0] && items[0].hasOwnProperty('words');

            // Apply Filters (only applies to decks)
            if (isDeck) {
                if (filter.type !== 'type_all') {
                    if (filter.type === 'source_ai') {
                        processedItems = processedItems.filter(d => d.is_ai_generated);
                    } else if (filter.type === 'source_user') {
                        processedItems = processedItems.filter(d => !d.is_ai_generated);
                    } else {
                        const typeMap = { type_vocab: 'Vocabulary', type_expr: 'Expressions', type_sub: 'Subtitle' };
                        processedItems = processedItems.filter(d => d.type === typeMap[filter.type]);
                    }
                }
                if (filter.size) {
                    const { op, val1, val2 } = filter.size;
                    const num1 = parseInt(val1, 10);
                    const num2 = parseInt(val2, 10);
                    processedItems = processedItems.filter(d => {
                        const wordCount = d.words?.length || 0;
                        if (op === 'gte') return wordCount >= num1;
                        if (op === 'lte') return wordCount <= num1;
                        if (op === 'eq') return wordCount === num1;
                        if (op === 'between') return wordCount >= num1 && wordCount <= num2;
                        return true;
                    });
                }
            }

            // Apply Sorting (applies to both decks and folders)
            processedItems.sort((a, b) => {
                // Primary Sort: Pinned items always come first (for decks)
                if (isDeck) {
                    const pinDiff = (b.isPinned || 0) - (a.isPinned || 0);
                    if (pinDiff !== 0) return pinDiff;
                }

                // Secondary Sort: Use the user's selected sort method
                switch (sort) {
                    case 'date_asc': 
                        // Folders don't have createdAt, so sort by name as a fallback
                        return (a.createdAt && b.createdAt) ? new Date(a.createdAt) - new Date(b.createdAt) : (a.title || a.name).localeCompare(b.title || b.name);
                    case 'name_asc': 
                        return (a.title || a.name).localeCompare(b.title || b.name);
                    case 'name_desc': 
                        return (b.title || b.name).localeCompare(a.title || a.name);
                    case 'date_desc':
                    default:
                        // Folders don't have createdAt, so sort by name as a fallback
                        return (a.createdAt && b.createdAt) ? new Date(b.createdAt) - new Date(a.createdAt) : (a.title || a.name).localeCompare(b.title || a.name);
                }
            });

            return processedItems;
        };
        
        const updateDeckSortUI = () => {
            const { sort, filter } = getCurrentViewState();
            deckSortToggleBtn.querySelector('i').className = sort.includes('_asc') ? 'ph ph-sort-ascending' : 'ph ph-sort-descending';
            const hasFilter = filter.type !== 'type_all' || filter.size !== null;
            deckSortToggleBtn.classList.toggle('has-filter', hasFilter);

            deckSortPopover.querySelectorAll('.sort-item.active').forEach(el => el.classList.remove('active'));
            deckSortPopover.querySelectorAll('.active-indicator').forEach(el => el.textContent = '');

            const activeSortItem = deckSortPopover.querySelector(`.sort-item[data-sort="${sort}"]`);
            if (activeSortItem) {
                activeSortItem.classList.add('active');
                const indicator = activeSortItem.closest('[data-sort-group]').querySelector('.active-indicator');
                if(indicator) indicator.textContent = `(${activeSortItem.querySelector('span').textContent})`;
            }
            const activeFilterTypeItem = deckSortPopover.querySelector(`.sort-item[data-sort="${filter.type}"]`);
            if (activeFilterTypeItem) {
                activeFilterTypeItem.classList.add('active');
                if (filter.type !== 'type_all') {
                    const indicator = activeFilterTypeItem.closest('[data-sort-group]').querySelector('.active-indicator');
                    if(indicator) indicator.textContent = `(${activeFilterTypeItem.querySelector('span').textContent})`;
                }
            }
            
            // --- THE FIX: Synchronize the "By Size" form with the current filter state ---
            const sizeOperatorEl = document.getElementById('deck-size-operator');
            const sizeValue1El = document.getElementById('deck-size-value-1');
            const sizeValue2El = document.getElementById('deck-size-value-2');
            const sizeValue2Wrapper = document.getElementById('deck-size-value-2-wrapper');
            
            if (filter.size) {
                const indicator = deckSortPopover.querySelector('[data-sort-group="size"] .active-indicator');
                if (indicator) {
                    const { op, val1, val2 } = filter.size;
                    let text = '';
                    if (op === 'gte') text = `> ${val1}`; else if (op === 'lte') text = `< ${val1}`;
                    else if (op === 'eq') text = `= ${val1}`; else if (op === 'between') text = `${val1}-${val2}`;
                    indicator.textContent = `(${text})`;
                }
                
                // Set the form state to match the active filter
                sizeOperatorEl.value = filter.size.op;
                sizeValue1El.value = filter.size.val1;
                sizeValue2El.value = filter.size.val2 || '';
                sizeValue2Wrapper.style.display = filter.size.op === 'between' ? 'flex' : 'none';

            } else {
                const allSizesItem = deckSortPopover.querySelector('.sort-item[data-sort="size_all"]');
                if (allSizesItem) allSizesItem.classList.add('active');
                
                // Reset the form to its default state when no size filter is active
                sizeOperatorEl.value = 'gte';
                sizeValue1El.value = '';
                sizeValue2El.value = '';
                sizeValue2Wrapper.style.display = 'none';
            }
        };

        const closeDeckSortMenu = () => {
            deckSortPopover.classList.remove('visible');
            deckSortToggleBtn.classList.remove('active');
        };

        deckSortToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = deckSortPopover.classList.toggle('visible');
            deckSortToggleBtn.classList.toggle('active', isVisible);

            // --- THE FIX: Align popover with the main content area ---
            if (isVisible) {
                // 1. Get the main content container for the decks screen.
                const contentContainer = DOM.deckViewContainer; // Use the main container from our DOM object
                if (!contentContainer) return;

                // 2. Get the positioning container of the popover (its parent).
                const popoverContainer = deckSortPopover.parentElement;

                // 3. Get the absolute screen positions of both elements.
                const contentRect = contentContainer.getBoundingClientRect();
                const containerRect = popoverContainer.getBoundingClientRect();

                // 4. Calculate the required left offset for the popover.
                const newLeftPosition = contentRect.left - containerRect.left;

                // 5. Apply the new static position.
                deckSortPopover.style.left = `${newLeftPosition}px`;
                deckSortPopover.style.right = 'auto'; // Ensure right alignment is cleared
                deckSortPopover.style.transformOrigin = 'top left'; // Animate from the top-left corner
            }
        });
        
        deckSortPopover.addEventListener('mouseover', (e) => {
            const parentItem = e.target.closest('.sort-item:has(.sort-submenu)');
            if (!parentItem) return;
            deckSortPopover.querySelectorAll('.sort-submenu.visible').forEach(s => {
                if (!parentItem.contains(s)) s.classList.remove('visible');
            });
            const submenu = parentItem.querySelector('.sort-submenu');
            if (!submenu || submenu.classList.contains('visible')) return;
            const parentRect = parentItem.getBoundingClientRect();
            if (parentRect.right + submenu.offsetWidth > window.innerWidth) {
                submenu.classList.add('opens-left'); submenu.classList.remove('opens-right');
            } else {
                submenu.classList.add('opens-right'); submenu.classList.remove('opens-left');
            }
            submenu.classList.add('visible');
        });
        deckSortPopover.addEventListener('mouseleave', () => {
             deckSortPopover.querySelectorAll('.sort-submenu.visible').forEach(s => s.classList.remove('visible'));
        });

        deckSortPopover.addEventListener('click', (e) => {
            const clickedItem = e.target.closest('.sort-item');
            if (!clickedItem || clickedItem.querySelector('.sort-submenu') || clickedItem.closest('form')) return;
            
            const state = getCurrentViewState();
            const sortKey = clickedItem.dataset.sort;
            if (sortKey) {
                if (sortKey.startsWith('type_') || sortKey.startsWith('source_')) state.filter.type = sortKey;
                else if (sortKey === 'size_all') state.filter.size = null;
                else state.sort = sortKey;
                
                saveViewStates();
                renderDeckScreen(); // Re-render with new settings
                updateDeckSortUI();
                closeDeckSortMenu();
            }
        });


        // --- NEW: Deck Display Mode Toggler ---
        
        const applyDeckDisplayMode = (mode) => {
            const state = getCurrentViewState();
            state.viewMode = mode;
            saveViewStates();
            
            // Update the button icon immediately
            const icon = DOM.deckDisplayModeToggleBtn.querySelector('i');
            if (mode === 'list') {
                icon.className = 'ph ph-squares-four';
                DOM.deckDisplayModeToggleBtn.title = 'Switch to Grid View';
            } else {
                icon.className = 'ph ph-list-bullets';
                DOM.deckDisplayModeToggleBtn.title = 'Switch to List View';
            }
            
            renderDeckScreen(); // Re-render the current view with the new mode
        };

        DOM.deckDisplayModeToggleBtn.addEventListener('click', () => {
            const currentMode = getCurrentViewState().viewMode;
            const newMode = currentMode === 'grid' ? 'list' : 'grid';
            applyDeckDisplayMode(newMode);
        });
        document.getElementById('deck-clear-filters-btn').addEventListener('click', () => {
         const state = getCurrentViewState();
         state.sort = 'date_desc';
         state.filter = { type: 'type_all', size: null };
         saveViewStates();
         renderDeckScreen();
         updateDeckSortUI();
         closeDeckSortMenu();
    });

        const deckSizeOperatorEl = document.getElementById('deck-size-operator');
        deckSizeOperatorEl.addEventListener('change', () => {
            document.getElementById('deck-size-value-2-wrapper').style.display = deckSizeOperatorEl.value === 'between' ? 'flex' : 'none';
        });
        document.getElementById('deck-sort-by-size-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const val1 = document.getElementById('deck-size-value-1').value;
            const val2 = document.getElementById('deck-size-value-2').value;
            if (!val1 || (deckSizeOperatorEl.value === 'between' && !val2)) return;
            
            const state = getCurrentViewState();
            state.filter.size = { op: deckSizeOperatorEl.value, val1, val2 };
            saveViewStates();
            renderDeckScreen();
            updateDeckSortUI();
            closeDeckSortMenu();
    });

        // Add a general click listener to close the new menu
        document.addEventListener('click', (e) => {
            if (deckSortPopover.classList.contains('visible') && !e.target.closest('#deck-sort-toggle-btn') && !e.target.closest('#deck-sort-popover')) {
                closeDeckSortMenu();
            }

        });

// Helper for the 'All Decks' view which now just calls the main sort/filter logic
function applyAllDecksFilters() {
    const processedDecks = applyLocalDeckSortAndFilter();

    const gridContainer = document.getElementById('all-decks-grid-container');
    const listContainer = document.getElementById('all-decks-list-container');
    const noResultsEl = document.getElementById('no-decks-filter-results');

    // THE FIX: Explicitly clear the inactive view's content before rendering the active one.
    if (allDecksViewMode === 'list') {
        ui.renderDecksList(processedDecks, listContainer);
        gridContainer.innerHTML = ''; // Clear the grid content
    } else { // 'grid'
        ui.renderDecks(processedDecks, gridContainer);
        listContainer.innerHTML = ''; // Clear the list content
    }

    // Now, correctly toggle the visibility of the parent containers and the no-results message
    const gridParent = DOM.allDecksGridViewContainer;
    const listParent = DOM.allDecksListViewContainer;

    if (processedDecks.length === 0) {
        noResultsEl.style.display = 'block';
        gridParent.classList.remove('active');
        listParent.classList.remove('active');
    } else {
        noResultsEl.style.display = 'none';
        if (allDecksViewMode === 'list') {
            gridParent.classList.remove('active');
            listParent.classList.add('active');
        } else {
            listParent.classList.remove('active');
            gridParent.classList.add('active');
        }
    }
    
    updateDeckSortUI();
}

// Helper for the main 'Folders' view
function renderFoldersMainView() {
    // --- NEW: Filter for top-level folders only ---
    const parentFolders = folders.filter(f => f.parentId === null);

    // --- NEW: Calculate usage and sort for "Top Folders" ---
    const sortedParentFolders = parentFolders.map(folder => {
        // Find all decks in this folder and its sub-folders to calculate true usage
        const getAllChildFolderIds = (parentId) => {
            let childIds = [];
            folders.filter(f => f.parentId === parentId).forEach(child => {
                childIds.push(child.id, ...getAllChildFolderIds(child.id));
            });
            return childIds;
        };
        const allFolderIds = [folder.id, ...getAllChildFolderIds(folder.id)];
        const decksInFamily = decks.filter(d => allFolderIds.includes(d.folderId));
        
        const lastUsedTimestamp = Math.max(0, ...decksInFamily.map(d => new Date(d.lastSeen || 0).getTime()));

        return { ...folder, lastUsed: lastUsedTimestamp };
    }).sort((a, b) => b.lastUsed - a.lastUsed);

    // Render Top Folders (List View)
    DOM.folderListView.innerHTML = '';
    sortedParentFolders.slice(0, 5).forEach(f => {
        const deckCount = decks.filter(d => d.folderId === f.id).length; // Count only direct children for display
        DOM.folderListView.innerHTML += `
            <div class="folder-list-item" data-folder-id="${f.id}">
                <i class="ph-fill ph-folder folder-icon" style="color:${f.color || 'var(--accent-primary)'};"></i>
                <div class="folder-details">
                    <p class="folder-name">${f.name}</p>
                    <p class="folder-meta">${deckCount} deck(s)</p>
                </div>
            </div>`;
    });

    // Render All Folders (Grid View Carousel) - using only parent folders
    const carousel = DOM.folderGridView.querySelector('.folders-carousel');
    carousel.innerHTML = '';
    parentFolders.forEach(f => {
        carousel.innerHTML += `
            <div class="folder-grid-card" data-folder-id="${f.id}">
                <div class="folder-grid-preview" style="color:${f.color || 'var(--accent-primary)'};"><i class="ph-fill ph-folder-open"></i></div>
                <p class="folder-grid-name">${f.name}</p>
            </div>`;
    });
}




// --- UI Rendering ---


async function populateWordData(apiModule, currentApiKeys, wordObject, deck, maxRetries = 3) {
    const deckType = deck.type || 'Vocabulary';
    let needsSave = false;
    console.log(`[App/Populate] 🔷 Entered populateWordData for "${wordObject.text}" in a "${deckType}" deck.`);

    // --- THE FIX: Block 1 - Automated Content (Definitions, Translations, MW) ---
    // This entire block is now self-contained and checks all its specific settings.
    const isAutoDefEnabled = automationSettings.enableAutoDefinitions &&
                             automationSettings.autoDefinitionsDeckTypes[deckType] !== false &&
                             !automationSettings.autoDefinitionsDeckTypes.blacklist.includes(deck.id);
    
    // --- NEW LOGGING ---
    console.log(`[Populate/Check] ⚙️ Content Automation is ${isAutoDefEnabled ? 'ENABLED' : 'DISABLED'} for "${wordObject.text}". (Master: ${automationSettings.enableAutoDefinitions}, Type "${deckType}": ${automationSettings.autoDefinitionsDeckTypes[deckType] !== false}, Blacklisted: ${automationSettings.autoDefinitionsDeckTypes.blacklist.includes(deck.id)})`);

    if (isAutoDefEnabled && navigator.onLine) {
        const hasFlashcard = !!wordObject.definitions.flashcard;
        const hasDetailed = !!wordObject.definitions.detailed;
        const shouldFetchEnglishDef = (!hasFlashcard || !hasDetailed) && deckType !== 'General Study';

        // --- Fetch English Definition ---
        if (shouldFetchEnglishDef) {
            try {
                if (deckType === 'Vocabulary' || deckType === 'Expressions') {
                    // Unified logic: Try free dictionary first for both types.
                    if (!apiSettings.publicDictionary) throw new Error('Public Dictionary API is disabled in Settings.'); // <-- THIS IS THE NEW GUARD CLAUSE
                    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(wordObject.text)}`);
                    if (!response.ok) throw new Error(`Dictionary API error: ${response.status}`);
                    const data = await response.json();
                    if (!data || data.length === 0) throw new Error('No definition found.');
                    const entry = data[0];
                    const firstDefinition = entry.meanings?.[0]?.definitions?.[0]?.definition;
                    if (!firstDefinition) throw new Error('Valid entry but no definition text found.');

                    wordObject.definitions.detailed = { word: entry.word, phonetic: entry.phonetic || entry.phonetics.find(p => p.text)?.text, meanings: entry.meanings };
                    if (!wordObject.definitions.flashcard) wordObject.definitions.flashcard = firstDefinition;
                    needsSave = true;

                } else if (deckType === 'Subtitle') {
                    // Subtitles always use AI for context.
                    const explanation = await api.getExplanationFromAi(wordObject, deck);
                    wordObject.definitions.flashcard = explanation.flashcard;
                    wordObject.definitions.detailed = explanation.detailed;
                    needsSave = true;
                }
            } catch (error) {
                // Fallback to AI for Vocab/Expressions if dictionary fails.
                console.warn(`   [Populate] Fallback: Dictionary failed for "${wordObject.text}". Using AI. Reason: ${error.message}`);
                try {
                    const explanation = await api.getExplanationFromAi(wordObject, deck);
                    if (!wordObject.definitions.flashcard) wordObject.definitions.flashcard = explanation.flashcard;
                    if (!wordObject.definitions.detailed) wordObject.definitions.detailed = explanation.detailed;
                    
                    // --- THIS IS THE FIX: Extract the example from the detailed explanation ---
                    if (!wordObject.example && typeof explanation.detailed === 'string') {
                        const match = explanation.detailed.match(/(?:Example:|e\.g\.)\s*"?(.+?)"?$/im);
                        if (match && match[1]) {
                            wordObject.example = match[1].trim();
                        }
                    }
                    needsSave = true;
                } catch (aiError) {
                    console.error(`[Populate] FAILED to get any definition for "${wordObject.text}": ${aiError.message}`);
                }
            }
        }

        // --- Fetch Amharic Definition (Gemini) ---
        if (!wordObject.definitions.gemini && deckType !== 'General Study') {
            try {
                const amharicDef = await apiModule.getAmharicDefinitionFromGemini(wordObject.text);
                wordObject.definitions.gemini = amharicDef;
                needsSave = true;
            } catch (error) {
                console.error(`[Populate] FAILED to get Amharic definition: ${error.message}`);
            }
        }

        // --- Fetch Merriam-Webster Data ---
        if (!wordObject.definitions.merriamWebster && deckType === 'Vocabulary') {
            try {
                const [dictData, thesData] = await Promise.all([
                    apiModule.callSupabaseFunction('merriam-webster-lookup', { type: 'dictionary', word: wordObject.text.toLowerCase() }),
                    apiModule.callSupabaseFunction('merriam-webster-lookup', { type: 'thesaurus', word: wordObject.text.toLowerCase() })
                ]);
                wordObject.definitions.merriamWebster = { dictionary: dictData, thesaurus: thesData };
                needsSave = true;
            } catch (error) {
                console.error(`[Populate] FAILED to get MW data: ${error.message}`);
            }
        }
    }

    // --- THE FIX: Block 2 - Quick Image Placeholders ---
    // This now runs completely independently of the definition logic.
    // This now correctly checks the main 'enableImageAutomation' toggle and its associated deck type settings.
    const isImageAutomationOn = automationSettings.enableImageAutomation &&
                                automationSettings.imageAutomationDeckTypes[deckType] !== false &&
                                !automationSettings.imageAutomationDeckTypes.blacklist.includes(deck.id);

    if (isImageAutomationOn && wordObject.isImageProvisional && !wordObject.imageUrl && navigator.onLine) {
        try {
            const searchQuery = wordObject.text;
            const imageResult = await api.searchUnsplash(searchQuery);
            if (imageResult && !imageResult.error && imageResult.images.length > 0) {
                wordObject.imageUrl = imageResult.images[0].url;
                wordObject.image_query = searchQuery;
                wordObject.isImageProvisional = true; // THE FIX: Explicitly set the flag
                needsSave = true;
            }
        } catch (error) {
            console.error(`[Populate] FAILED to get provisional image: ${error.message}`);
        }
    }

    // --- Block 3 (Example Sentence Generation) is now REMOVED. ---
    // We get the example from the AI's detailed explanation.
    // If the public dictionary API was successful, we can still parse an example from there.
    if (!wordObject.example) {
        if (deckType === 'Vocabulary' && wordObject.definitions.detailed?.meanings) {
            for (const meaning of wordObject.definitions.detailed.meanings) {
                for (const def of meaning.definitions) {
                    if (def.example) {
                        wordObject.example = def.example;
                        needsSave = true;
                        break;
                    }
                }
                if (wordObject.example) break;
            }
        }
    }

    if (needsSave) {
        saveDecksToStorage();
    }
    
    return wordObject;
}

    /**
     * Loads API keys and initializes only the core API-dependent services.
     * This runs at the very start of the app, before other modules are initialized.
     */
    async function initializeCoreApi() {
        console.log("⚙️ [App] Initializing core API services...");
        loadApiKeysFromStorage();
        loadApiSettings(); // --- THIS IS THE NEW LINE ---

        api.initApi({ supabaseUrl, supabaseAnonKey, apiSettings }); // --- THIS LINE IS MODIFIED ---

        wotd.initWotd({
            getState: () => ({ decks, supabaseUrl, supabaseAnonKey, automationSettings }),
            actions: {
                ui,
                createNewSrsWord,
                saveDecksToStorage,
            },
            api
        });

        await wotd.processWordOfTheDay();
    }

    // --- NEW: Function to reinitialize API-dependent services ---
    async function reinitializeApiAndServices() {
        console.log("🔄 [App] Reinitializing API and dependent services...");

        // 1. Re-initialize the API module itself
        api.initApi({ supabaseUrl, supabaseAnonKey });

        // 2. Update the app's internal currentApiKeys object
        currentApiKeys = {
            geminiApiKey: supabaseAnonKey, // Use supabase key as a truthy value
            unsplashApiKey: supabaseAnonKey, // Use supabase key as a truthy value
            omdbApiKey: supabaseAnonKey, // Use supabase key as a truthy value
            supabaseUrl,
            supabaseAnonKey
        };

        // 3. Re-process Word of the Day
        await wotd.processWordOfTheDay(); // Await to ensure WotD data is ready before rendering home
        home.showHomeScreen(); // Re-render home screen to show updated WotD

        // 4. Restart background image refiner
        refineWordImagesInBackground();

        // 5. If currently in DeckViewer, re-render the current word
        if (DOM.screens.viewDeck.classList.contains('active')) {
            const currentDeck = deckViewer.getCurrentDeck(); // Get the currently active deck
            const currentWordInViewer = deckViewer.getCurrentWord(); // Get the word currently displayed

            if (currentDeck && currentWordInViewer) {
                console.log(`🔄 [App] Re-rendering current word "${currentWordInViewer.text}" in DeckViewer...`);
                // Use deckViewer.openDeck to force a re-render of the same word.
                // This triggers displayCurrentWord, which will then re-run populateWordData and UI refresh.
                deckViewer.openDeck(currentDeck, currentWordInViewer.text);
            }
        }
        
        // 6. Re-render the deck screen (e.g., if WOTD image was missing and now loaded, it will show up)
        renderDeckScreen();

        // 7. Re-render movie list, just in case (e.g. if OMDb search was failing)
        movie.renderMoviesList();
    }


    function openDeck(deck, wordToShowText = null) {
        console.log(`[App LOG] openDeck function initiated for deck: "${deck ? deck.title : 'NULL DECK'}"`);
        if (!deck) {
            console.error("[App LOG] CRITICAL ERROR: openDeck was called with a null or undefined deck object.");
            ui.showToast("Error: Tried to open an invalid deck.", true);
            return;
        }

        try {
            // Delegate opening the deck to the new module
            console.log("[App LOG] Delegating to deckViewer.openDeck...");
            deckViewer.openDeck(deck, wordToShowText);
            console.log("[App LOG] deckViewer.openDeck completed without crashing.");
        } catch (error) {
            console.error("[App LOG] CRITICAL ERROR: A crash occurred inside deckViewer.openDeck.", error);
            ui.showToast("A critical error occurred while opening the deck.", true);
        }
        
        // The mainSearchInput.value is not cleared here anymore to preserve search state.
        // ui.handleSearch('', decks, folders); will be called when returning from modal.
    }

    // --- Navigation & UI Functions ---
    
    /**
     * Overridden showMainScreen to handle specific on-enter logic for screens.
     * @param {HTMLElement} screenToShow - The screen element to make active.
     * @param {HTMLElement} activeNavLink - The nav link to highlight.
     */
    function showMainScreenWithUpdates(screenToShow, activeNavLink) {
        // THE FIX: If we are navigating TO the decks screen, re-render it.
        if (screenToShow === DOM.screens.decks) {
            renderDeckScreen();
        }

        // Always call the original UI function to handle the actual screen switch.
        ui.showMainScreen(screenToShow, activeNavLink);
    }








async function parseSrt(srtContent) {
    if (!srtContent) return [];

    const toastId = 'srt-parser-toast'; // Unique ID for our toasts

    // --- Phase 1: Initial Simple Parse ---
    function simpleParse(content) {
        // (The inner workings of simpleParse remain the same)
        const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        const subtitles = [];
        let i = 0;
        while (i < lines.length) {
            const number = lines[i];
            const timestamp = lines[i + 1];
            if (number && timestamp && timestamp.includes('-->')) {
                let textLines = [];
                let j = i + 2;
                while (lines[j] && lines[j].trim() !== '') {
                    textLines.push(lines[j]);
                    j++;
                }
                const text = textLines.join(' ').replace(/<[^>]+>/g, '').trim();
                if (text) {
                    subtitles.push({ number, timestamp: timestamp.split(' --> ')[0], text });
                }
                i = j + 1;
            } else {
                i++;
            }
        }
        return subtitles;
    }

    ui.showToast("Parsing SRT file...", false, toastId, true);
    console.log("[SRT Parser] Phase 1: Starting initial simple parse.");
    let initialResult = simpleParse(srtContent);

    // --- Phase 2: Heuristic Check ---
    const isLikelyMisparsed = initialResult.length > 0 && initialResult[0].text.length > 200;

    if (!isLikelyMisparsed) {
        console.log(`[SRT Parser] SUCCESS: Simple parse successful with ${initialResult.length} lines. No advanced parsing needed.`);
        ui.hideToast(toastId);
        ui.showToast("SRT parsed successfully!", false);
        return initialResult;
    }

    // --- Phase 3: Advanced Pattern Detection ---
    ui.showToast("File seems malformed. Attempting to self-heal...", false, toastId, true);
    console.warn("[SRT Parser] Phase 2: Heuristic check failed. Starting advanced self-healing process.");
    
    const allLines = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let firstValidLineIndex = -1;
    let pattern = { hasNumberLine: false };

    for (let i = 0; i < allLines.length; i++) {
        if (allLines[i] && allLines[i].includes('-->')) {
            pattern.hasNumberLine = (i > 0 && /^\d+$/.test(allLines[i-1].trim()));
            firstValidLineIndex = pattern.hasNumberLine ? i - 1 : i;
            break;
        }
    }

    if (firstValidLineIndex === -1) {
        console.error("[SRT Parser] FAILURE: Could not find any valid timestamp pattern. Aborting advanced parse.");
        ui.hideToast(toastId);
        ui.showToast("Could not parse SRT file. Displaying best attempt.", true);
        return initialResult; // Fallback to the messy initial result
    }
    
    console.log(`[SRT Parser] Phase 3: Found first valid pattern at line ${firstValidLineIndex}. Pattern includes number line: ${pattern.hasNumberLine}.`);
    const malformedHeader = allLines.slice(0, firstValidLineIndex).join('\n').trim();
    const cleanSrtBody = allLines.slice(firstValidLineIndex).join('\n');
    let healedResult = simpleParse(cleanSrtBody);
    console.log(`[SRT Parser] Healed parse yielded ${healedResult.length} lines from the main body.`);

    // --- Phase 4: AI Fallback ---
    if (malformedHeader) {
        const { supabaseUrl, supabaseAnonKey } = getState();
        if (supabaseUrl && supabaseAnonKey && navigator.onLine) {
            ui.showToast("Using AI to correct file header...", false, toastId, true);
            console.log("[SRT Parser] Phase 4: Attempting AI correction for malformed header...");
            try {
                const exampleGoodBlock = allLines.slice(firstValidLineIndex, firstValidLineIndex + 4).join('\n');
                const prompt = `You are a subtitle file repair expert. The following text is a corrupted header from an SRT file. Fix it to match the standard SRT block format. Each block should have a number, a timestamp, and text. Do not add any extra text or explanations. Just output the corrected blocks.

Correct Format Example:
${exampleGoodBlock}

Corrupted Text to Fix:
---
${malformedHeader}
---`;
                const correctedHeader = await api.getGroqCompletion([{ role: 'user', content: prompt }]);
                const aiFixedSubs = simpleParse(correctedHeader);

                if (aiFixedSubs.length > 0) {
                    healedResult = [...aiFixedSubs, ...healedResult];
                    console.log(`[SRT Parser] AI SUCCESS: AI successfully corrected ${aiFixedSubs.length} header block(s).`);
                    ui.showToast("AI correction successful!", false, toastId);
                } else {
                    console.warn("[SRT Parser] AI ran but did not produce valid subtitle blocks.");
                }
            } catch (aiError) {
                console.error("[SRT Parser] AI FAILURE: AI correction failed:", aiError);
                ui.showToast("AI correction failed. Using partial result.", true, toastId);
            }
        } else {
            console.log("[SRT Parser] Skipping AI correction: No API keys or offline.");
        }
    }

    // --- Phase 5: Final Renumbering & Return ---
    console.log("[SRT Parser] Phase 5: Finalizing and renumbering subtitle list.");
    healedResult.forEach((sub, index) => {
        sub.number = String(index + 1);
    });

    ui.hideToast(toastId);
    ui.showToast(`Advanced parse complete! Found ${healedResult.length} lines.`, false);
    return healedResult;
}

async function filterSafeImages(images) {
    if (!images || images.length === 0) {
        return [];
    }

    // --- Step 1: Fast local keyword filtering ---
    const forbiddenKeywords = [
        'bikini', 'lingerie', 'underwear', 'nude', 'naked', 'erotic',
        'boudoir', 'sensual', 'provocative', 'scantily clad', 'cleavage', 'bra', 'panty'
    ];
    
    const initiallyFilteredImages = images.filter(img => {
        const lowercasedDescription = (img.description || '').toLowerCase();
        for (const keyword of forbiddenKeywords) {
            if (lowercasedDescription.includes(keyword)) {
                console.warn(`[AI Safety] Pre-filtered image due to keyword: "${keyword}"`);
                return false; // Exclude this image
            }
        }
        return true; // Keep this image
    });

    if (initiallyFilteredImages.length === 0) {
        console.log("[AI Safety] All images were rejected by the initial keyword filter.");
        return [];
    }

    // --- Step 2: Bulk AI check for the remaining images ---
    if (!supabaseUrl || !supabaseAnonKey) {
        console.log("[AI Safety] Supabase not configured, returning keyword-filtered images.");
        return initiallyFilteredImages;
    }

    try {
        const descriptionsForAI = initiallyFilteredImages.map((img, index) => 
            `Image ${index}: "${img.description}"`
        ).join('\n');

        const safetyPrompt = `You are an AI content moderator. I will provide a list of image descriptions. For each image, you must decide if it is "SAFE" or "UNSAFE". "UNSAFE" means any description that is NSFW, revealing, suggestive, or features swimwear/underwear.

${descriptionsForAI}

You MUST respond with ONLY a valid JSON object. The object should have a single key "results", which is an array of objects. Each object must have two keys: "image_index" (the original index number) and "status" (either "SAFE" or "UNSAFE").`;

        const moderationResult = await api.getJsonFromAi([{ role: 'user', content: safetyPrompt }]);
        
        if (!moderationResult || !Array.isArray(moderationResult.results)) {
            console.warn("[AI Safety] AI did not return a valid 'results' array. Assuming all are safe as a fallback.");
            return initiallyFilteredImages;
        }

        const unsafeIndexes = new Set(
            moderationResult.results
                .filter(res => res.status === 'UNSAFE')
                .map(res => res.image_index)
        );

        const finalSafeImages = initiallyFilteredImages.filter((img, index) => {
            if (unsafeIndexes.has(index)) {
                console.warn(`[AI Safety] AI flagged Image ${index} as UNSAFE: "${img.description}"`);
                return false;
            }
            return true;
        });

        return finalSafeImages;

    } catch (error) {
        console.error("[AI Safety] Error during bulk AI moderation:", error);
        // In case of a catastrophic API failure, return the keyword-filtered list as a safe fallback.
        return initiallyFilteredImages;
    }
}

function formatRelativeTime(dateString) {
    if (!dateString) return "never";
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.round((now - date) / 1000);
    const minutes = Math.round(seconds / 60);
    const hours = Math.round(minutes / 60);
    const days = Math.round(hours / 24);
    const months = Math.round(days / 30.44); // Average month length
    const years = Math.round(days / 365);

    if (seconds < 60) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    if (hours < 24) return `${hours} hr ago`;
    if (days < 30) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (months < 12) return `${months} mo ago`;
    return `${years} yr ago`;
}

function truncateInMiddle(text, maxLength) {
    if (!text || text.length <= maxLength) {
        return text;
    }
    const ellipsis = '...';
    const charsToShow = maxLength - ellipsis.length;
    const frontChars = Math.ceil(charsToShow / 2);
    const backChars = Math.floor(charsToShow / 2);

    return text.substring(0, frontChars) + ellipsis + text.substring(text.length - backChars);
}



function srtTimeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(/[:,]/);
    const hours = parseInt(parts[0], 10) || 0;
    const minutes = parseInt(parts[1], 10) || 0;
    const seconds = parseInt(parts[2], 10) || 0;
    const milliseconds = parseInt(parts[3], 10) || 0;
    return (hours * 3600) + (minutes * 60) + seconds + (milliseconds / 1000);
}
function secondsToSrtTime(totalSeconds) {
    if (typeof totalSeconds !== 'number' || isNaN(totalSeconds)) return null;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const milliseconds = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000);

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}
function formatRelativeTime(dateString) {
    if (!dateString) return "never";
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.round((now - date) / 1000);
    const minutes = Math.round(seconds / 60);
    const hours = Math.round(minutes / 60);
    const days = Math.round(hours / 24);

    if (seconds < 60) return "just now";
    if (minutes < 60) return `${minutes} minute(s) ago`;
    if (hours < 24) return `${hours} hour(s) ago`;
    return `${days} day(s) ago`;
}
   



    /**
     * Reusable function to find the best image for a given query and context using AI.
     * @param {string} query - The term to search for on Unsplash.
     * @param {string} context - The thematic context for the AI to consider.
     * @returns {Promise<string|null|undefined>} URL string on success, null on rejection, undefined on error.
     */
    async function getBestImageForQuery(query, context) {
    // Groq calls are proxied through Supabase, so check for Supabase keys
    if (!supabaseUrl || !supabaseAnonKey) {
        console.log("🧠 [AI Image Search] Skipping: Supabase URL or Key is missing.");
        return null;
    }

        try {
            const imageResults = await api.searchUnsplash(query);
            if (!imageResults.images || imageResults.images.length === 0) {
                console.log(`❌ [AI Image Search] No Unsplash results for "${query}".`);
                return null;
            }

            // --- NEW: BULK AI SAFETY PRE-FILTER ---
            const safeImages = await filterSafeImages(imageResults.images);

            if (safeImages.length === 0) {
                console.log(`[AI Image Search] All images for query "${query}" were rejected by the safety filter.`);
                return null;
            }
            // --- END OF SAFETY PRE-FILTER ---

            const imageDescriptions = safeImages.map((img, index) =>
                `Image ${index}: "${img.description}" (URL: ${img.url})`
            ).join('\n');

            const prompt = `I need to find the best image for the theme: "${context}".

From the following list of image descriptions, choose the ONE that is the most conceptually and semantically relevant. Do not just match keywords.

${imageDescriptions}

Respond with ONLY the full URL of the best image. If NONE of the images are a good conceptual fit, respond with the single word: "REJECT".`;

            const chosenUrl = await api.getGroqCompletion([{ role: 'user', content: prompt }]);

            if (chosenUrl && chosenUrl.trim().toUpperCase() !== 'REJECT' && chosenUrl.startsWith('http')) {
                console.log(`✅ [AI Image Search] AI selected an image for query "${query}".`);
                return chosenUrl.trim();
            } else {
                console.log(`🤷 [AI Image Search] AI rejected all images for "${query}".`);
                return null;
            }
     } catch (error) {
        // --- THE FIX: Propagate rate limit errors up the chain ---
        if (error.message.includes("API rate limit exceeded")) {
            console.warn(`[AI Image Search] Rate limit error received. Propagating to stop the background process.`);
            throw error; // Re-throw the error so the calling function knows to stop.
        }
        // For other errors, log them but don't stop the entire background process.
        console.error(`❌ [AI Image Search] Error during analysis for "${query}":`, error);
        return undefined;
    }
}

// --- NEW: Blacklist Modal Logic ---
function openBlacklistModal(contextKey) {
currentBlacklistContext = contextKey;
if (!automationSettings[contextKey]) return;
const contextMap = {
        'instantImageDeckTypes': 'Quick Image Placeholders',
        'betterImageDeckTypes': 'AI Image Upgrades',
        'autoDefinitionsDeckTypes': 'Automated Content Fetching'
    };
    document.getElementById('blacklist-modal-title').textContent = `Blacklist for ${contextMap[contextKey]}`;
    
    const blacklistSet = new Set(automationSettings[contextKey].blacklist || []);
    const allEligibleDecks = decks.filter(d => d.type !== 'General Study');

    const vocabDecks = allEligibleDecks.filter(d => d.type === 'Vocabulary');
    const exprDecks = allEligibleDecks.filter(d => d.type === 'Expressions');
    const subDecks = allEligibleDecks.filter(d => d.type === 'Subtitle');

    _renderBlacklistDeckList(vocabDecks, document.getElementById('blacklist-vocab-list'), blacklistSet);
    _renderBlacklistDeckList(exprDecks, document.getElementById('blacklist-expr-list'), blacklistSet);
    _renderBlacklistDeckList(subDecks, document.getElementById('blacklist-sub-list'), blacklistSet);

    document.getElementById('blacklist-search-input').value = '';
    _handleBlacklistTabSwitch(document.querySelector('.blacklist-tab-btn.active')); // Set initial tab state
    ui.showModal(DOM.screens.blacklist);
}

function _renderBlacklistDeckList(decksToRender, container, blacklistSet, searchQuery = '') {
    const filteredDecks = searchQuery
        ? decksToRender.filter(d => d.title.toLowerCase().includes(searchQuery))
        : decksToRender;

    if (filteredDecks.length === 0) {
        container.innerHTML = `<p class="no-results-message">No decks of this type found.</p>`;
        return;
    }

    container.innerHTML = filteredDecks.map(deck => {
        const isChecked = blacklistSet.has(deck.id);
        const imageStyle = deck.imageUrl ? `style="background-image: url('${deck.imageUrl}');"` : '';
        const imageClass = deck.imageUrl ? '' : `css-bg-${(parseInt(deck.id) % 4) + 1}`;
        return `
            <label class="blacklist-deck-item">
                <div class="blacklist-deck-item-image ${imageClass}" ${imageStyle}></div>
                <div class="blacklist-deck-item-text">
                    <p class="blacklist-deck-item-title">${deck.title}</p>
                    <p class="blacklist-deck-item-meta">${deck.words.length} words</p>
                </div>
                <div class="blacklist-checkbox-wrapper">
                    <input type="checkbox" data-deck-id="${deck.id}" ${isChecked ? 'checked' : ''}>
                    <div class="blacklist-checkbox"><i class="ph-fill ph-check"></i></div>
                </div>
            </label>
        `;
    }).join('');
}

function _handleBlacklistTabSwitch(targetTab) {
    if (!targetTab) return;
    document.querySelectorAll('.blacklist-tab-btn').forEach(t => t.classList.remove('active'));
    targetTab.classList.add('active');

    document.querySelectorAll('.blacklist-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`blacklist-panel-${targetTab.dataset.tab}`).classList.add('active');

    const indicator = document.querySelector('.blacklist-tab-indicator');
    indicator.style.left = `${targetTab.offsetLeft}px`;
    indicator.style.width = `${targetTab.offsetWidth}px`;
}

// --- NEW HELPER FOR RESIZE EVENTS ---
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    // This function is now a simple wrapper for our new, powerful helper.
    async function getBestImageUsingAI(wordObject, deckObject) {
        console.log(`🧠 [AI Word Analysis] Starting for "${wordObject.text}".`);
        
        const populatedWord = await populateWordData(api, currentApiKeys, wordObject, deckObject);
        const definition = populatedWord.definitions.flashcard || 'No definition available.';
        
        if (definition.includes('not found') || definition.includes('Could not')) {
             console.log(`❌ [AI Word Analysis] No definition for "${wordObject.text}", cannot analyze images.`);
             return null;
        }

        // --- THE FIX: Generate a smart query first, THEN search. ---
        // Step 1: Generate a smart search term with AI.
        const searchTermPrompt = `You are an AI that generates effective search terms for image APIs like Unsplash. Your goal is to find a visually descriptive image. Based on the following word and its definition, provide a single, concise search term (2-4 words is ideal). Respond with ONLY the search term itself, no quotes or extra text.

Word: "${populatedWord.text}"
Definition: "${definition}"`;

        const searchTerm = await api.getGroqCompletion([{ role: 'user', content: searchTermPrompt }]);
        if (!searchTerm || searchTerm.trim() === '') {
            console.log(`❌ [AI Word Analysis] AI failed to generate a search term for "${wordObject.text}".`);
            return null;
        }
        const cleanSearchTerm = searchTerm.trim();
        console.log(`   [AI Word Analysis] Generated smart query: "${cleanSearchTerm}"`);

        // Step 2: Use the generated term to find the best image.
        const chosenImageUrl = await getBestImageForQuery(cleanSearchTerm, definition);
        
        if (chosenImageUrl) {
            // Step 3: Return the image URL AND the smart query that found it.
            return { imageUrl: chosenImageUrl, query: cleanSearchTerm }; 
        }
        return null;
    }

     // --- NEW: Backup & Restore Handlers ---

    function triggerExport() {
        // Gather all data from different modules and state
        const exportPayload = {
            decks: decks,
            folders: folders,
            movies: movie.getMovies(),
            quizHistory: quiz.getQuizHistory(),
            proficiencyLog: proficiencyLog,
            conversations: chat.getConversations()
        };
        backupManager.handleExport(exportPayload);
    }



    // --- Event Listeners Setup ---
    function setupEventListeners() {
        // --- Sidebar Toggling ---
        function toggleSidebar() {
            DOM.deckSidebar.classList.toggle('open');
            DOM.deckSidebarOverlay.classList.toggle('open');
        }
        document.getElementById('sidebar-toggle-btn').addEventListener('click', toggleSidebar);
        DOM.deckSidebarOverlay.addEventListener('click', toggleSidebar);

        // --- Sidebar Navigation Clicks ---
        DOM.deckSidebar.addEventListener('click', e => {
            // Handle "Manage Folders" button click
            if (e.target.closest('.manage-folders-btn')) {
                renderManageFoldersList();
                ui.showModal(DOM.manageFoldersScreen);
                toggleSidebar(); // Close the sidebar after opening the modal
                return;
            }

            const navItem = e.target.closest('.sidebar-item');
            if (!navItem) return;

            // --- NEW/FIXED: Differentiate between expand/collapse and navigation clicks ---
            const caretClickTarget = e.target.closest('.caret-button');
            if (caretClickTarget && navItem.classList.contains('has-children')) {
                // Click was specifically on the caret area of a collapsible item
                if (navItem.classList.contains('folder-section-header')) {
                    // This is the main "Folders" header
                    navItem.parentElement.classList.toggle('expanded');
                } else {
                    // This is a specific folder item
                    navItem.parentElement.classList.toggle('expanded');
                }
                // IMPORTANT: Only return here. Do not proceed to navigation.
                return;
            }
            
            // If the click was NOT on the caret, the code continues to the navigation logic below...
            
            const type = navItem.dataset.navType;
            if (type === 'all') {
                setDeckView('all');
                DOM.decksScreenTitle.textContent = "All Decks";
            } else if (type === 'folders') {
                 setDeckView('folders');
                 DOM.decksScreenTitle.textContent = "Folders";
            } else if (type === 'folder') {
                const folderId = navItem.dataset.folderId;
                setDeckView('folder_' + folderId, folderId);
                const folder = folders.find(f => f.id === folderId);
                DOM.decksScreenTitle.textContent = folder ? folder.name : 'Folder';
            }
            
            renderDeckScreen();
            toggleSidebar();
        });

        // --- NEW: Folder View Toggling and Folder Clicks ---
        let currentFolderViewStyle = 'list'; // 'list' or 'grid'
        DOM.viewToggleBtn.addEventListener('click', () => {
            if (currentFolderViewStyle === 'list') {
                currentFolderViewStyle = 'grid';
                DOM.folderListView.classList.remove('visible');
                DOM.folderGridView.classList.add('visible');
                DOM.viewToggleBtn.innerHTML = '<i class="ph ph-list-bullets"></i>';
                DOM.folderViewAreaTitle.textContent = 'All Folders';
            } else {
                currentFolderViewStyle = 'list';
                DOM.folderGridView.classList.remove('visible');
                DOM.folderListView.classList.add('visible');
                DOM.viewToggleBtn.innerHTML = '<i class="ph ph-squares-four"></i>';
                DOM.folderViewAreaTitle.textContent = 'Top Folders';
            }
        });

            DOM.deckViewContainer.addEventListener('click', e => {
        const folderItem = e.target.closest('.folder-list-item, .folder-grid-card');
        if (folderItem) {
            if (folderItem.dataset.navType === 'folders') { // Navigating up to the main folder view
                setDeckView('folders');
                DOM.decksScreenTitle.textContent = "Folders"; // --- THIS IS THE FIX ---
            } else { // Navigating into a folder
                const folderId = folderItem.dataset.folderId;
                setDeckView('folder_' + folderId, folderId);
                const folder = folders.find(f => f.id === folderId); // Also update title when going down
                DOM.decksScreenTitle.textContent = folder ? folder.name : 'Folder';
            }
            renderDeckScreen();
        }
    });
        // --- Folder Management Event Listeners ---
        document.getElementById('add-folder-btn').addEventListener('click', () => openAddEditFolderModal(null, activeFolderId));
        document.getElementById('save-folder-btn').addEventListener('click', handleSaveFolder);
        
        DOM.folderColorPicker.addEventListener('click', e => {
            const swatch = e.target.closest('.color-swatch');
            if (swatch) {
                DOM.folderColorPicker.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
                swatch.classList.add('selected');
            }
        });

        document.body.addEventListener('click', e => {
             // Handle clicks inside the Manage Folders screen
            if (e.target.closest('#manage-folders-screen')) {
                const manageBtn = e.target.closest('.manage-folders-btn');
                if (manageBtn) {
                    renderManageFoldersList();
                    ui.showModal(DOM.manageFoldersScreen);
                    return;
                }
                const addBtn = e.target.closest('#add-new-folder-from-manage-btn');
                if(addBtn) {
                    openAddEditFolderModal();
                    return;
                }
                 const editBtn = e.target.closest('.folder-action-btn.edit');
                if (editBtn) {
                    const folderId = editBtn.closest('.manage-folder-item').dataset.folderId;
                    const folder = folders.find(f => f.id === folderId);
                    if (folder) openAddEditFolderModal(folder);
                    return;
                }
                const deleteBtn = e.target.closest('.folder-action-btn.delete');
                if (deleteBtn) {
                    const folderId = deleteBtn.closest('.manage-folder-item').dataset.folderId;
                    handleDeleteFolder(folderId);
                    return;
                }
            }
        });

        // --- Global Click Listener for Menus, Search Collapse, and Selection Exit ---
        document.addEventListener('click', (e) => {
            // Close active pop-up menus
            if (!e.target.closest('.options-container') && !e.target.closest('.popover-toggle')) {
                ui.closeActiveMenu();
            }

            // --- THE FIX: Close active sliding submenus ---
            // If the main menu itself wasn't clicked, we check for open submenus.
            else if (!e.target.closest('.flashcard-option-parent')) {
                const activeSubmenu = document.querySelector('.flashcard-option-parent.submenu-active');
                if (activeSubmenu) {
                    activeSubmenu.classList.remove('submenu-active');
                }
            }

            // Collapse active header search bars
            const decksHeader = document.getElementById('decks-header');
            const moviesHeader = document.getElementById('movie-list-header');
            const exploreHeader = document.getElementById('explore-header'); 

            if (decksHeader.classList.contains('search-active') && !e.target.closest('#decks-header')) {
                decksHeader.classList.remove('search-active');
            }
            if (moviesHeader && moviesHeader.classList.contains('search-active') && !e.target.closest('#movie-list-header')) {
                moviesHeader.classList.remove('search-active');
            }
            
            if (exploreHeader && exploreHeader.classList.contains('search-active') && !e.target.closest('#explore-header')) {
                exploreHeader.classList.remove('search-active');
            }

            // --- THE FIX: Exit selection mode on outside click ---
            if (isSelectionMode.decks && !e.target.closest('.grid-deck-card') && !e.target.closest('#deck-selection-delete-bar') && !e.target.closest('#move-to-folder-modal')) {
                exitSelectionMode('decks');
            }
            if (isSelectionMode.history && !e.target.closest('.history-quiz-item') && !e.target.closest('#history-selection-delete-bar')) {
                exitSelectionMode('history');
            }
            if (isSelectionMode.wotd && !e.target.closest('.wotd-log-entry') && !e.target.closest('#wotd-selection-delete-bar')) {
                exitSelectionMode('wotd');
            }
        });

        // --- Navigation ---
        DOM.navLinks.home.addEventListener('click', (e) => { e.preventDefault(); exitSelectionMode('decks'); showMainScreenWithUpdates(DOM.screens.home, DOM.navLinks.home); home.showHomeScreen(); });
        DOM.navLinks.decks.addEventListener('click', (e) => { e.preventDefault(); showMainScreenWithUpdates(DOM.screens.decks, DOM.navLinks.decks); });
        DOM.navLinks.chat.addEventListener('click', (e) => { e.preventDefault(); exitSelectionMode('decks'); showMainScreenWithUpdates(DOM.screens.chat, DOM.navLinks.chat); });
        DOM.navLinks.movie.addEventListener('click', (e) => { e.preventDefault(); showMainScreenWithUpdates(DOM.screens.movieList, DOM.navLinks.movie); });
        DOM.navLinks.settings.addEventListener('click', (e) => {
            e.preventDefault();
            // Standard navigation always happens
            showMainScreenWithUpdates(DOM.screens.settings, DOM.navLinks.settings);

            // Triple-tap logic to toggle backend settings
            settingsTapCount++;
            if (settingsTapTimer) clearTimeout(settingsTapTimer);
            if (settingsTapCount === 3) {
                const wrapper = DOM.backendSettingsWrapper;
                const isVisible = wrapper.classList.toggle('visible');
                localStorage.setItem('wordwiseBackendSettingsVisible', isVisible);
                settingsTapCount = 0; // Reset counter
            } else {
                settingsTapTimer = setTimeout(() => {
                    settingsTapCount = 0;
                }, 600); // 600ms window for triple-tapping
            }
        });

        // --- Settings & Theme ---
                document.getElementById('theme-toggle-btn').addEventListener('click', () => { const html = document.documentElement; html.classList.toggle('dark-theme'); const isDark = html.classList.contains('dark-theme'); localStorage.setItem('wordwiseTheme', isDark ? 'dark' : 'light'); applySavedTheme(); });
                
                // --- NEW: Study Experience Setting Listeners ---
                document.getElementById('study-experience-toggle').addEventListener('click', () => {
                    const container = document.getElementById('study-experience-container');
                    const icon = document.querySelector('#study-experience-toggle .ph-caret-right');
                    const isVisible = container.style.display === 'block';
                    container.style.display = isVisible ? 'none' : 'block';
                    icon.style.transform = isVisible ? 'rotate(0deg)' : 'rotate(90deg)';
                });

                // --- NEW: Reverse Flashcards Listener ---
                document.getElementById('reverse-flashcards-toggle').addEventListener('change', (e) => {
                    studySettings.reverseFlashcards = e.target.checked;
                    saveStudySettings();
                });

                // --- Default Deck View Setting Listeners ---
                document.getElementById('default-view-toggle').addEventListener('click', () => {
                    const container = document.getElementById('default-view-options-container');
                    const isVisible = container.style.display === 'block';
                    if (isVisible) {
                        container.style.maxHeight = '0px';
                        container.style.padding = 'var(--space-sm) 0'; // Animate padding out
                        setTimeout(() => container.style.display = 'none', 400); // Hide after animation
                    } else {
                        container.style.display = 'block';
                        // Use setTimeout to allow the display property to apply before changing maxHeight
                        setTimeout(() => {
                             container.style.padding = 'var(--space-sm) var(--space-md)'; // Animate padding in
                             container.style.maxHeight = '100px'; // Animate open
                        }, 10);
                    }
                });

                document.querySelector('#default-view-options-container').addEventListener('click', (e) => {
                    const button = e.target.closest('.view-mode-btn');
                    if (button) {
                        const newMode = button.id.replace('set-default-view-', '');
                        setDefaultDeckView(newMode);
                        // Optional: close the selector after a choice is made
                        document.getElementById('default-view-toggle').click();
                    }
                });

                

                document.getElementById('show-proficiency-stats-btn').addEventListener('click', renderGlobalStats);
        
        // --- NEW: Backup & Restore Listeners ---
        backupManager.setupBackupEventListeners();

        // --- NEW: Danger Zone Listeners ---
        document.getElementById('danger-zone-toggle').addEventListener('click', () => {
            const container = document.getElementById('danger-zone-container');
            const icon = document.querySelector('#danger-zone-toggle .ph-caret-right');
            const isVisible = container.style.display === 'block';
            if (isVisible) {
                container.style.maxHeight = '0px';
                setTimeout(() => container.style.display = 'none', 400);
            } else {
                container.style.display = 'block';
                setTimeout(() => container.style.maxHeight = '200px', 10);
            }
            icon.style.transform = isVisible ? 'rotate(0deg)' : 'rotate(90deg)';
        });

        document.getElementById('reset-progress-btn').addEventListener('click', async () => {
            const confirmed = await showConfirmationDialog({
                title: "Reset All Progress?",
                message: "This will reset the Spaced Repetition (SRS) data for every word in every deck. Your words and decks will NOT be deleted. Are you sure?",
                confirmText: "Reset Progress",
                confirmStyle: "danger",
                iconClass: "ph-fill ph-arrow-counter-clockwise"
            });
            if (confirmed) {
                decks.forEach(deck => {
                    deck.words.forEach(word => {
                        word.interval = 0;
                        word.factor = 2.5;
                        word.lastSeen = null;
                    });
                });
                saveDecksToStorage();
                ui.showToast("All learning progress has been reset.");
            }
        });

        document.getElementById('factory-reset-btn').addEventListener('click', async () => {
            const confirmed = await showConfirmationDialog({
                title: "Factory Reset?",
                message: "This will PERMANENTLY delete ALL your decks, folders, movies, settings, chat history, and quiz progress. This action cannot be undone.",
                confirmText: "Delete Everything",
                confirmStyle: "danger",
                iconClass: "ph-fill ph-skull"
            });
            if (confirmed) {
                ui.showToast("Resetting app... The page will now reload.");
                localStorage.clear();
                setTimeout(() => location.reload(), 1500);
            }
        });

        // --- NEW: AI & Automation Hub Modal Listener ---
    // --- NEW: API Services Listeners ---
        document.getElementById('api-services-toggle').addEventListener('click', () => {
            syncApiSettingsUI(); // Ensure UI is up-to-date when opening
            const container = document.getElementById('api-services-container');
            const icon = document.querySelector('#api-services-toggle .ph-caret-right');
            const isVisible = container.style.display === 'block';
            container.style.display = isVisible ? 'none' : 'block';
            icon.style.transform = isVisible ? 'rotate(0deg)' : 'rotate(90deg)';
        });
        document.getElementById('groq-api-toggle').addEventListener('change', (e) => { apiSettings.groq = e.target.checked; saveApiSettings(); });
        document.getElementById('gemini-api-toggle').addEventListener('change', (e) => { apiSettings.gemini = e.target.checked; saveApiSettings(); });
        document.getElementById('mw-api-toggle').addEventListener('change', (e) => { apiSettings.merriamWebster = e.target.checked; saveApiSettings(); });
        document.getElementById('image-api-toggle').addEventListener('change', (e) => { apiSettings.images = e.target.checked; saveApiSettings(); });
        document.getElementById('public-dictionary-api-toggle').addEventListener('change', (e) => { apiSettings.publicDictionary = e.target.checked; saveApiSettings(); }); // --- THIS IS THE NEW LINE ---

        document.getElementById('ai-automation-toggle').addEventListener('click', () => {
        syncAiAutomationModalUI(); // Sync the UI with current settings
        ui.showModal(DOM.screens.aiAutomation);
    });
        

                
                // --- NEW: Supabase Listeners ---
                document.getElementById('supabase-keys-toggle').addEventListener('click', () => {
                    const container = document.getElementById('supabase-keys-container');
                    const icon = document.querySelector('#supabase-keys-toggle .ph-caret-right');
                    const isVisible = container.style.display === 'block';

                    if (isVisible) {
                        // Animate closing
                        container.style.maxHeight = '0px';
                        setTimeout(() => container.style.display = 'none', 400);
                    } else {
                        // Animate opening
                        container.style.display = 'block';
                        setTimeout(() => {
                            container.style.maxHeight = '500px'; // A large enough value to fit content
                            // Scroll to the bottom to reveal the newly opened section
                            const settingsScreen = DOM.screens.settings;
                            settingsScreen.scrollTo({
                                top: settingsScreen.scrollHeight,
                                behavior: 'smooth'
                            });
                        }, 10); // Small delay for DOM reflow
                    }
                    icon.style.transform = isVisible ? 'rotate(0deg)' : 'rotate(90deg)';
                });
                                document.getElementById('save-supabase-url-btn').addEventListener('click', async () => {
                    const key = document.getElementById('supabase-url-input').value.trim();
                    supabaseUrl = key;
                    saveCredentialToStorage(key, 'SupabaseUrl');
                    ui.showToast('Supabase URL saved!');
                    await reinitializeApiAndServices(); // Reinitialize all dependent services
                });
                document.getElementById('save-supabase-anon-key-btn').addEventListener('click', async () => {
                    const key = document.getElementById('supabase-anon-key-input').value.trim();
                    supabaseAnonKey = key;
                    saveCredentialToStorage(key, 'SupabaseAnonKey');
                    ui.showToast('Supabase Anon Key saved!');
                    await reinitializeApiAndServices(); // Reinitialize all dependent services
                });

        // --- MAIN DELEGATED CLICK LISTENER FOR THE ENTIRE APP ---
    
    
                document.body.addEventListener('click', (e) => {
            // --- NEW: Handle Favorite Toggling ---
            const favoriteBtn = e.target.closest('.favorite-toggle-btn');
            if (favoriteBtn) {
                e.preventDefault();
                e.stopPropagation();
                const { deckId, wordText } = favoriteBtn.dataset;
                if (deckId && wordText) {
                    handleToggleFavorite(deckId, wordText);
                }
                return;
            }

            // --- NEW: Handle clicks for journey chart filters ---
            if (e.target.closest('#journey-chart-filters')) {
                const button = e.target.closest('.filter-pill');
                if (button) {
                    currentChartFilterDays = parseInt(button.dataset.days, 10);
                    document.querySelectorAll('#journey-chart-filters .filter-pill').forEach(b => b.classList.remove('active'));
                    button.classList.add('active');
                    renderJourneyChart();
                }
                return; // Stop further processing
            }
            
// --- NEW: Add Deck Source Choice ---
            if (e.target.closest('#source-choice-create-new')) {
                deckManager.resetCreateDeckModal();
                ui.showModal(DOM.screens.deckType);
                return;
            }
            if (e.target.closest('#source-choice-explore-public')) {
                // CRITICAL FIX: Close the sort menu before showing the screen
                const exploreSortPopover = document.getElementById('explore-sort-popover');
                const exploreSortToggleBtn = document.getElementById('explore-sort-toggle-btn');
                exploreSortPopover.classList.remove('visible');
                exploreSortToggleBtn.classList.remove('active');
                
                showExploreDecksScreen();
                return;
            }

// --- NEW: Import Conflict Modal Logic ---
            const conflictModalCloseBtn = e.target.closest('#import-conflict-modal .close-modal-btn');
            if (conflictModalCloseBtn) {
                // Return to the previous modal, which is the detail screen
                ui.showModal(DOM.screens.exploreDetail);
                return;
            }
            if (e.target.closest('#conflict-action-merge')) {
                handleMergeWithExisting();
                return;
            }
            if (e.target.closest('#conflict-action-rename')) {
                const renameSection = document.getElementById('rename-deck-section');
                const renameInput = document.getElementById('conflict-rename-input');
                renameSection.style.display = 'block';
                renameInput.value = `${currentPublicDeck.title} (Copy)`; // Pre-fill with a suggestion
                renameInput.focus();
                return;
            }
            if (e.target.closest('#conflict-save-renamed-btn')) {
                handleSaveRenamedDeck();
                return;
            }

            // --- NEW: Explore Public Decks Logic ---
            const publicDeckCard = e.target.closest('.published-deck-card');
            if (publicDeckCard) {
                showExploreDetailScreen(publicDeckCard.dataset.deckId);
                return;
            }
            if (e.target.closest('#explore-detail-back-btn')) {
                ui.showModal(DOM.screens.exploreList);
                return;
            }
            if (e.target.closest('#import-public-deck-btn')) {
                handleImportPublicDeck();
                return;
            }

            // --- NEW: Handle clicks for the confirmation overlay (now a separate modal) ---
            if (e.target.closest('#image-confirm-overlay')) {
                const confirmBtn = e.target.closest('#confirm-image-selection-btn');
                const cancelBtn = e.target.closest('#cancel-image-selection-btn');

                if (confirmBtn) {
                    if (selectedImageUrl) {
                        handleImageSelection(selectedImageUrl);
                    }
                    return;
                }
                // If cancel is clicked, or the dark background is clicked, just close the overlay.
                if (cancelBtn || !e.target.closest('#image-confirm-content')) {
                    DOM.screens.imageConfirmOverlay.classList.remove('active');
                    selectedImageUrl = null;
                    return;
                }
            }

            // --- NEW: Handle clicks inside the Image Search Modal ---
            if (e.target.closest('#image-search-modal')) {
                // Handle pagination clicks
                const prevBtn = e.target.closest('#image-search-prev-btn');
                const nextBtn = e.target.closest('#image-search-next-btn');

                // --- THE FIX: New pagination logic with toast feedback ---
                if (prevBtn) {
                    if (imageSearchCurrentPage <= 1) {
                        ui.showToast("You are on the first page.");
                        prevBtn.disabled = true; // Prevent spamming
                    } else {
                        imageSearchCurrentPage--;
                        renderImageSearchPage();
                    }
                    return;
                }
                if (nextBtn) {
                    const totalPages = Math.ceil(imageSearchResults.length / IMAGES_PER_PAGE);
                    if (imageSearchCurrentPage >= totalPages) {
                        ui.showToast("No more results.");
                        nextBtn.disabled = true; // Prevent spamming
                    } else {
                        imageSearchCurrentPage++;
                        renderImageSearchPage();
                    }
                    return;
                }

                // Handle the underlying search modal
                const card = e.target.closest('.image-result-card');
                const searchBtn = e.target.closest('#image-search-submit-btn');
                const closeBtn = e.target.closest('.close-modal-btn');

                if (card) {
                    showImageConfirmation(card.dataset.imageUrl);
                } else if (searchBtn) {
                    handleImageSearch();
                } else if (closeBtn) {
                    // NEW: Check the context to decide where to go back to
                    if (imageSearchContext.type === 'movie_poster_update') {
                        // If we were editing a movie, go back to the edit hub
                        ui.showModal(DOM.screens.editMovie);
                    } else {
                        // Otherwise, perform the default close action
                        ui.closeAllModals(true);
                    }
                }
                return; // Prevent other handlers
            }

            // --- NEW: Handle clicks inside the hierarchical "Move to Folder" modal ---
            if (e.target.closest('#move-to-folder-modal')) {
                const drillDownBtn = e.target.closest('.drill-down-btn');
                const folderOption = e.target.closest('.list-option');
                const backBtn = e.target.closest('#move-to-folder-back-btn');
                const confirmBtn = e.target.closest('#confirm-move-btn');
                

            const closeBtn = e.target.closest('.close-modal-btn');

                if (closeBtn) { // User clicked the 'X' button
                    ui.closeAllModals();
                } else if (drillDownBtn) { // User wants to navigate into a folder
                    e.stopPropagation();
                    renderMoveToFolderList(drillDownBtn.dataset.folderId);
                } else if (folderOption) { // User is selecting a folder as the destination
                    document.querySelectorAll('#move-to-folder-list .list-option').forEach(opt => opt.classList.remove('selected'));
                    folderOption.classList.add('selected');
                    currentMoveTargetFolderId = folderOption.dataset.folderId;
                    document.getElementById('confirm-move-btn').disabled = false;
                } else if (backBtn) { // User wants to navigate up
                    const parentId = backBtn.dataset.parentId === 'null' ? null : backBtn.dataset.parentId;
                    renderMoveToFolderList(parentId);
                } else if (confirmBtn && !confirmBtn.disabled) { // User confirms the move
                    handleMoveSelectedDecks(currentMoveTargetFolderId);
                }
                return; // Prevent other handlers from firing
            }
            // --- First, delegate all movie-related clicks to the movie module ---
            movie.handleMovieEvents(e);
            
            // --- NEW: Handle clicks from the Rename Titles modal ---
            if (e.target.closest('#save-renamed-titles-btn')) {
                movie.handleSaveRenamedTitles(); // Call the exported function
            }
// --- NEW: Add-words-from-empty-deck button ---
            if (e.target.closest('#add-words-to-empty-deck-btn')) {
                e.preventDefault();
                const deckToEdit = deckViewer.getCurrentDeck();
                if (deckToEdit) {
                    deckManager.handleEditDeck(deckToEdit);
                }
                return;
            }
            const editBtn = e.target.closest('.edit-btn');
            if (editBtn) {
                e.preventDefault(); e.stopPropagation(); ui.closeActiveMenu();
                const card = editBtn.closest('[data-deck-id]');
                if (card) {
                    const deckId = card.dataset.deckId;
                    const deck = decks.find(d => d.id === deckId);
                    if (deck) deckManager.handleEditDeck(deck);
                }
                return;
            }
            // --- Now handle all other app-wide clicks ---
            const wotdLogBtn = e.target.closest('.wotd-log-btn');
            if (wotdLogBtn) {
                e.preventDefault(); e.stopPropagation(); ui.closeActiveMenu();
                const wotdDeck = decks.find(d => d.isSpecial);
                if (wotdDeck) {
                    ui.renderWotdLog(wotdDeck);
                    ui.showModal(DOM.screens.wotdLog);
                }
                return;
            }
            // --- NEW: Handle clicks for View Deck header options ---
            if (e.target.closest('#header-deck-options-btn')) {
                e.preventDefault(); e.stopPropagation();
                const menu = e.target.closest('.options-container').querySelector('.options-menu');
                ui.toggleMenu(menu, 'options');
                return;
            }
            if (e.target.closest('#header-deck-edit-btn')) {
                e.preventDefault(); e.stopPropagation(); ui.closeActiveMenu();
                const currentDeck = deckViewer.getCurrentDeck();
                if (currentDeck) deckManager.handleEditDeck(currentDeck);
                return;
            }
            if (e.target.closest('#header-deck-test-btn')) {
                e.preventDefault(); e.stopPropagation(); ui.closeActiveMenu();
                const currentDeck = deckViewer.getCurrentDeck();
                if (currentDeck) {
                    quiz.setQuizDeckId(currentDeck.id);
                    document.getElementById('test-type-deck-title').textContent = `Test '${currentDeck.title}'`;
                    ui.showModal(DOM.screens.testType);
                }
                return;
            }
            if (e.target.closest('#header-deck-export-btn')) {
                e.preventDefault(); e.stopPropagation(); ui.closeActiveMenu();
                const currentDeck = deckViewer.getCurrentDeck();
                if (currentDeck) {
                    backupManager.exportSingleDeck(currentDeck);
                }
                return;
            }
            if (e.target.closest('#header-deck-log-btn')) {
                 e.preventDefault(); e.stopPropagation(); ui.closeActiveMenu();
                const currentDeck = deckViewer.getCurrentDeck();
                if (currentDeck && currentDeck.isSpecial) {
                    ui.renderWotdLog(currentDeck);
                    ui.showModal(DOM.screens.wotdLog);
                }
                return;
            }

            // --- NEW: Handle clicks on individual WotD log items ---
            const wotdLogEntry = e.target.closest('.wotd-log-entry');
            if (wotdLogEntry) {
        
        
                e.preventDefault();

                if (isSelectionMode.wotd) {
                    // We are in selection mode. Any tap on an item should toggle its selection.
                    toggleSelection('wotd', wotdLogEntry); // THE FIX
                } else if (pressTimer !== null) {
                    // This is a clean tap (not the end of a long press).
                    // We clear the timer and proceed with the normal click action (opening the portfolio).
                    clearTimeout(pressTimer);
                    const wordText = wotdLogEntry.querySelector('.wotd-log-word').textContent;
                    const wotdDeck = decks.find(d => d.isSpecial);
                    const wordObject = wotdDeck?.words.find(w => w.text === wordText);
                    if (wordObject) {
                        wotd.openWotdPortfolio(wordObject);
                    } else {
                        ui.showToast("Could not find data for that word.", true);
                    }
                }
                // The pressTimer becomes null only after a successful long press, correctly preventing this block from running.
                return; // Ensure we stop processing here for any wotdLogEntry click.
            }
            const uploadBtn = e.target.closest('.upload-btn');
            if (uploadBtn) {
                e.preventDefault(); e.stopPropagation(); ui.closeActiveMenu();
                const card = uploadBtn.closest('[data-deck-id]');
                if (card) {
                    handleUploadDeck(card.dataset.deckId);
                }
                return;
            }

            const testBtn = e.target.closest('.test-btn');
            if (testBtn) {
                e.preventDefault(); e.stopPropagation();
                ui.closeActiveMenu();
                const card = testBtn.closest('[data-deck-id]');
                if (card) {
                    const deckId = card.dataset.deckId;
                    const deck = decks.find(d => d.id === deckId);
                    if (deck) {
                        quiz.setQuizDeckId(deckId);
                        document.getElementById('test-type-deck-title').textContent = `Test '${deck.title}'`;
                        ui.showModal(DOM.screens.testType);
                    }
                }
                return;
            }

            if (e.target.closest('#start-tf-quiz-btn')) { e.preventDefault(); quiz.startQuiz(); return; }
            if (e.target.closest('#start-mc-quiz-btn')) { e.preventDefault(); quiz.startMcQuiz(); return; }
            if (e.target.closest('#start-fib-quiz-btn')) { e.preventDefault(); quiz.startFibQuiz(); return; }
if (e.target.closest('#start-ir-quiz-btn')) { e.preventDefault(); quiz.startIrQuiz(); return; }
            if (e.target.closest('#quiz-history-btn')) { e.preventDefault(); quiz.showQuizHistory(); return; }

            // --- NEW/FIXED: Quiz History List Click ---
            const historyItem = e.target.closest('.history-quiz-item');
            if (historyItem) {
                if (isSelectionMode.history) {
                    toggleSelection('history', historyItem); // THE FIX
                } else if (pressTimer !== null) { // Only navigate on a clean tap
                    clearTimeout(pressTimer);
                    quiz.renderReviewScreen(historyItem.dataset.quizId);
                }
                return;
            }

                     if (e.target.closest('#add-deck-btn')) { e.preventDefault(); deckManager.handleAddNewDeck(); return; }

            const deckTypeChoice = e.target.closest('#deck-type-screen .list-option');
            if (deckTypeChoice) {
                e.preventDefault();
                let type = 'Vocabulary';
                if (deckTypeChoice.id === 'create-deck-expressions') type = 'Expressions';
                if (deckTypeChoice.id === 'create-deck-subtitle') type = 'Subtitle';
                if (deckTypeChoice.id === 'create-deck-study') type = 'General Study';
                deckManager.handleDeckTypeSelect(type);
                return;
            }

            if (e.target.closest('#deck-type-screen [data-action="close-modal"]')) { e.preventDefault(); ui.closeAllModals(); ui.showMainScreen(DOM.screens.decks, DOM.navLinks.decks); return; }
            if (e.target.closest('#add-manually-btn')) { e.preventDefault(); deckManager.handleOpenRichCardEditor(); return; }
            if (e.target.closest('#close-create-deck-btn')) { e.preventDefault(); ui.closeAllModals(); ui.showMainScreen(DOM.screens.decks, DOM.navLinks.decks); return; }
            if (e.target.closest('#back-to-create-deck-btn')) { e.preventDefault(); ui.showModal(DOM.screens.createDeck); return; }
            if (e.target.closest('#save-manual-words-btn')) { e.preventDefault(); deckManager.handleSaveManualWords(); return; }
                if (e.target.closest('#import-from-list-btn')) { e.preventDefault(); document.getElementById('import-file-input').click(); return; }
            if (e.target.closest('#confirm-import-btn')) { e.preventDefault(); deckManager.handleConfirmImport(); return; }
            if (e.target.closest('#cancel-import-btn')) { e.preventDefault(); deckManager.handleCancelImport(); return; }
            
            // --- NEW: Listeners for the Import Confirmation Modal ---
            const importItem = e.target.closest('.import-summary-item');
            if (importItem && !importItem.classList.contains('is-duplicate')) {
                importItem.classList.toggle('is-selected');
                // We need to call a function in deckManager to update the summary
                deckManager.updateImportSummary(); // We will expose this function
                return;
            }
            if (e.target.closest('#import-select-all-checkbox')) {
                // This is a direct input element, so we can't just use closest.
                // We'll let the change event handle this logic instead.
                return;
            }
                    const assignImageParent = e.target.closest('#assign-image-parent');
            if (assignImageParent && !e.target.closest('.flashcard-submenu-btn')) {
                e.preventDefault(); e.stopPropagation();
                assignImageParent.classList.toggle('submenu-active');
                return;
            }
            if (e.target.closest('#assign-image-ai-btn')) { e.preventDefault(); e.stopPropagation(); deckManager.handleAssignImageWithAI(); return; }
            if (e.target.closest('#assign-image-search-btn')) { e.preventDefault(); e.stopPropagation(); deckManager.handleOpenImageSearch(); return; }
        if (e.target.closest('#create-deck-submit-btn')) { e.preventDefault(); deckManager.handleSubmitDeck(); return; }

            // --- NEW: Simple/Rich Editor Toggle Listeners ---
            if (e.target.closest('#toggle-simple-editor-btn')) {
                e.preventDefault();
                deckManager.handleOpenSimpleWordEditor();
                return;
            }
            if (e.target.closest('#back-to-rich-editor-btn')) {
                e.preventDefault();
                ui.showModal(DOM.screens.richCardEditor);
                return;
            }
            if (e.target.closest('#save-simple-words-btn')) {
                e.preventDefault();
                deckManager.handleSaveSimpleWords();
                return;
            }
            
            // --- Generic Modal Close Button Logic ---
            const genericCloseBtn = e.target.closest('.close-modal-btn');
            if (genericCloseBtn) {
                // NEW: If the 'X' is on the generic confirmation dialog, let its own logic handle it.
                if (genericCloseBtn.closest('#confirm-action-modal')) {
                    return; // Do nothing and let the specific handler in showConfirmationDialog work.
                }

                // THE FIX: Ignore buttons that are handled by the movie module
                if (genericCloseBtn.closest('#edit-movie-modal') || genericCloseBtn.closest('#rename-titles-modal')) {
                    return;
                }

                e.preventDefault();

                // Handle special cases like stopping a video player before closing
                if (genericCloseBtn.closest('#video-player-screen')) {
                    const videoPlayer = document.getElementById('main-video-player');
                    if (videoPlayer) {
                        videoPlayer.pause();
                        videoPlayer.removeAttribute('src');
                        videoPlayer.innerHTML = '';
                    }
                }

                // THE FIX: This single call now handles all navigation correctly by
                // using the 'lastActiveScreen' state variable, which is set
                // whenever any modal is opened.
                ui.closeAllModals(true);
            }
        });
        
        // Listener for the "Select All" checkbox in the import modal
        document.getElementById('import-select-all-checkbox').addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            document.querySelectorAll('#import-summary-list .import-summary-item:not(.is-duplicate)').forEach(item => {
                item.classList.toggle('is-selected', isChecked);
            });
            deckManager.updateImportSummary(); // Update counts and button state
        });

        // --- Deck Screen Specific Listeners ---
        document.getElementById('show-deck-search-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('decks-header').classList.add('search-active');
            DOM.mainSearchInput.focus();
        });

        // --- Explore Screen Specific Listeners ---
        document.getElementById('show-explore-search-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            const header = document.getElementById('explore-header');
            header.classList.add('search-active');
            document.getElementById('explore-search-input').focus();
        });

        

        document.getElementById('explore-search-input').addEventListener('input', (e) => {
            const query = e.target.value.trim().toLowerCase();
            if (query) {
                const filteredDecks = publicDecks.filter(deck => 
                    deck.title.toLowerCase().includes(query) || 
                    (deck.description && deck.description.toLowerCase().includes(query))
                );
                renderPublishedDecks(filteredDecks);
            } else {
                renderPublishedDecks(publicDecks); // Show all if search is cleared
            }
        });

        // --- NEW: Hiding Header on Scroll for Explore Screen ---
        const exploreModal = document.getElementById('explore-list-screen');
        const exploreHeader = document.getElementById('explore-header');
        let lastScrollTop = 0;

        exploreModal.addEventListener('scroll', () => {
            const scrollTop = exploreModal.scrollTop;
            const headerHeight = exploreHeader.offsetHeight;

            // Check if scrolling down and past the header's initial position
            if (scrollTop > lastScrollTop && scrollTop > headerHeight) {
                exploreHeader.classList.add('header-hidden');
            } else {
                // Scrolling up or at the very top
                exploreHeader.classList.remove('header-hidden');
            }
            // Update last scroll position (handle iOS bounce)
            lastScrollTop = scrollTop <= 0 ? 0 : scrollTop;
        });

        // --- NEW: Hiding Header on Scroll for Decks Screen ---
        const decksHeader = document.getElementById('decks-header');
        const decksScreen = DOM.screens.decks;
        let lastScrollTopForDecks = 0;

        decksScreen.addEventListener('scroll', () => {
            const scrollTop = decksScreen.scrollTop;
            const headerHeight = decksHeader.offsetHeight;

            if (scrollTop > lastScrollTopForDecks && scrollTop > headerHeight) {
                decksHeader.classList.add('header-hidden');
            } else {
                decksHeader.classList.remove('header-hidden');
            }
            lastScrollTopForDecks = scrollTop <= 0 ? 0 : scrollTop;
        }, false);


        // --- Movie Screen Specific Listeners ---
        document.getElementById('show-movie-search-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('movie-list-header').classList.add('search-active');
            document.getElementById('movie-list-search-input').focus();
        });
        document.getElementById('movie-list-search-input').addEventListener('input', movie.handleMovieSearch);
                        
        DOM.deleteDeckBtn.addEventListener('click', deckManager.handleDeleteDeck);
                                document.getElementById('home-decks-container').addEventListener('click', handleDeckGridClick);
                DOM.deckViewContainer.addEventListener('click', handleDeckGridClick);

        // --- NEW: Selection Mode Action Bar Listener ---
                document.getElementById('deck-selection-delete-bar').addEventListener('click', async (e) => {
            const pinBtn = e.target.closest('#deck-selection-pin-btn');
            const deleteBtn = e.target.closest('#deck-selection-delete-btn');
            const moveBtn = e.target.closest('#deck-selection-move-btn');
            const cancelBtn = e.target.closest('.cancel-selection-btn');
            
            // NEW: Get references to new buttons
            const testBtn = e.target.closest('#deck-selection-test-btn');
            const editBtn = e.target.closest('#deck-selection-edit-btn');
            const uploadBtn = e.target.closest('#deck-selection-upload-btn');
            const logBtn = e.target.closest('#deck-selection-log-btn');

            if (cancelBtn) {
                exitSelectionMode('decks');
                return;
            }

            if (pinBtn) {
                const selectedDecks = Array.from(selectedIds.decks).map(id => decks.find(d => d.id === id));
                const shouldPin = selectedDecks.some(deck => !deck.isPinned);
                let pinnedCount = 0;
                let unpinnedCount = 0;

                decks.forEach(deck => {
                    if (selectedIds.decks.has(deck.id)) {
                        if (shouldPin) {
                            deck.isPinned = true;
                            pinnedCount++;
                        } else {
                            deck.isPinned = false;
                            unpinnedCount++;
                        }
                    }
                });
                
                saveDecksToStorage();
                renderDeckScreen();
                exitSelectionMode('decks');
                if (pinnedCount > 0) ui.showToast(`${pinnedCount} deck(s) pinned.`);
                if (unpinnedCount > 0) ui.showToast(`${unpinnedCount} deck(s) unpinned.`);
                return;
            }

            // NEW: Handle single-action button clicks
            if (testBtn) {
                const [deckId] = selectedIds.decks;
                const deck = decks.find(d => d.id === deckId);
                if (deck) {
                    quiz.setQuizDeckId(deckId);
                    document.getElementById('test-type-deck-title').textContent = `Test '${deck.title}'`;
                    ui.showModal(DOM.screens.testType);
                }
                exitSelectionMode('decks');
                return;
            }
            if (editBtn) {
                const [deckId] = selectedIds.decks;
                const deck = decks.find(d => d.id === deckId);
                if (deck) deckManager.handleEditDeck(deck);
                exitSelectionMode('decks');
                return;
            }
            if (uploadBtn) {
                const [deckId] = selectedIds.decks;
                if (deckId) handleUploadDeck(deckId);
                exitSelectionMode('decks');
                return;
            }
            if (logBtn) {
                const [deckId] = selectedIds.decks;
                const deck = decks.find(d => d.id === deckId);
                if (deck && deck.isSpecial) {
                    ui.renderWotdLog(deck);
                    ui.showModal(DOM.screens.wotdLog);
                }
                exitSelectionMode('decks');
                return;
            }

            if (deleteBtn) {
                const selectedDecks = Array.from(selectedIds.decks).map(id => decks.find(d => d.id === id));
                
                // THE FIX: Filter out special decks BEFORE confirming deletion
                const deletableDecks = selectedDecks.filter(deck => deck && !deck.isSpecial);
                const specialDecksSelected = selectedDecks.filter(deck => deck && deck.isSpecial);

                if (specialDecksSelected.length > 0) {
                    const deckTitle = specialDecksSelected[0].title;
                    const message = specialDecksSelected.length > 1 
                        ? `The decks you selected include special system decks which cannot be deleted.`
                        : `The "${deckTitle}" deck is a special system deck and cannot be deleted.`;
                    ui.showToast(message, true);
                }

                if (deletableDecks.length > 0) {
                    const confirmed = await showConfirmationDialog({
                        title: `Delete ${deletableDecks.length} Deck(s)?`,
                        message: "This action is permanent and cannot be undone.",
                        confirmText: "Delete",
                        confirmStyle: "danger",
                        iconClass: "ph-fill ph-trash"
                    });
                    if (confirmed) {
                        const idsToDelete = new Set(deletableDecks.map(d => d.id));
                        decks = decks.filter(d => !idsToDelete.has(d.id));
                        saveDecksToStorage();
                        renderDeckScreen();
                    }
                }
                exitSelectionMode('decks');
            } else if (moveBtn) {
                openMoveToFolderModal();
            }
        });

        document.getElementById('history-selection-delete-bar').addEventListener('click', async (e) => { // THE FIX
            const cancelBtn = e.target.closest('.cancel-selection-btn'); // THE FIX
            if (cancelBtn) { // THE FIX
                exitSelectionMode('history');
                return;
            }

            const idsToDelete = Array.from(selectedIds.history);
            if (idsToDelete.length > 0) {
                const confirmed = await showConfirmationDialog({
                    title: `Delete ${idsToDelete.length} History Item(s)?`,
                    message: "This will permanently remove the selected quiz records.",
                    confirmText: "Delete",
                    confirmStyle: "danger",
                    iconClass: "ph-fill ph-trash"
                });
                if (confirmed) {
                    quiz.deleteQuizFromHistory(idsToDelete); // The quiz module handles its own data
                }
            }
            exitSelectionMode('history');
        });

        document.getElementById('wotd-selection-delete-bar').addEventListener('click', async (e) => { // THE FIX
            const cancelBtn = e.target.closest('.cancel-selection-btn'); // THE FIX
            if (cancelBtn) { // THE FIX
                exitSelectionMode('wotd');
                return;
            }

            const idsToDelete = Array.from(selectedIds.wotd);
            if (idsToDelete.length > 0) {
                const confirmed = await showConfirmationDialog({
                    title: `Delete ${idsToDelete.length} Log Item(s)?`,
                    message: "This will permanently remove the selected words from the log. This cannot be undone.",
                    confirmText: "Delete",
                    confirmStyle: "danger",
                    iconClass: "ph-fill ph-trash"
                });
                if (confirmed) {
                    const wotdDeck = decks.find(d => d.isSpecial);
                    if(wotdDeck) {
                        const idsSet = new Set(idsToDelete);
                        wotdDeck.words = wotdDeck.words.filter(word => !idsSet.has(word.text));
                        saveDecksToStorage();
                        ui.renderWotdLog(wotdDeck); // Re-render the list
                    }
                }
            }
            exitSelectionMode('wotd');
        });
        
        // --- Flashcard Interaction Listeners ---
        // --- NEW/IMPROVED: Long-press and selection mode listeners ---
                document.body.addEventListener('touchstart', (e) => {
            const targetDeck = e.target.closest('.grid-deck-card');
            const targetHistoryItem = e.target.closest('.history-quiz-item');
            const targetWotdItem = e.target.closest('.wotd-log-entry');
            const targetItem = targetDeck || targetHistoryItem || targetWotdItem;

            if (targetItem && !isSelectionMode.decks && !isSelectionMode.history) {
                pressTimer = setTimeout(() => {
                    e.preventDefault(); // Prevent context menu
                    if (navigator.vibrate) navigator.vibrate(50);
                    
                    longPressJustFinished = true; // THE FIX: Set the flag
                    
                    if (targetDeck) {
                        enterSelectionMode('decks', targetDeck); // THE FIX
                    } else if (targetHistoryItem) {
                        enterSelectionMode('history', targetHistoryItem); // THE FIX
                    } else if (targetWotdItem) {
                        enterSelectionMode('wotd', targetWotdItem); // THE FIX
                    }
                    pressTimer = null;
                }, 600);
            }
        }, { passive: false }); // THE FIX: Explicitly set passive to false for preventDefault.

        document.body.addEventListener('touchend', () => {
            clearTimeout(pressTimer);
            // THE FIX: Reset the flag after ANY touch ends, ensuring the next tap is clean.
            setTimeout(() => { longPressJustFinished = false; }, 0); 
        });
        document.body.addEventListener('touchmove', () => clearTimeout(pressTimer));
        document.body.addEventListener('touchcancel', () => clearTimeout(pressTimer));

        // Prevent right-click context menu on desktop
        DOM.deckViewContainer.addEventListener('contextmenu', e => {
            if (e.target.closest('.decks-grid-container')) {
                e.preventDefault();
            }
        });
        document.getElementById('quiz-history-list').addEventListener('contextmenu', e => e.preventDefault());

DOM.screens.aiAutomation.addEventListener('click', (e) => {
        // Handle master toggles
        const masterToggle = e.target.closest('.master-automation-toggle');
        if (masterToggle) {
            const featureKey = masterToggle.dataset.featureKey;
            automationSettings[featureKey] = masterToggle.checked;
            saveAutomationSettings();
            return; // Stop processing
        }

        // Handle deck type buttons
        const typeBtn = e.target.closest('.deck-type-btn');
        if (typeBtn) {
            const card = typeBtn.closest('.automation-card');
            const featureKey = card.dataset.featureKey;
            const deckType = typeBtn.dataset.type;
            
            // Toggle the setting
            const currentStatus = automationSettings[featureKey][deckType];
            automationSettings[featureKey][deckType] = !currentStatus;
            
            // Update UI and save
            typeBtn.classList.toggle('active', !currentStatus);
            saveAutomationSettings();
            return;
        }

        // Handle Manage Blacklists button
        const manageBlacklistsBtn = e.target.closest('#hub-manage-blacklists-btn');
        if (manageBlacklistsBtn) {
            ui.showModal(DOM.screens.blacklistContext);
            return;
        }
    });
    
    // --- NEW: Event Listeners for Blacklist Modal ---
    document.querySelector('.blacklist-tabs').addEventListener('click', e => {
        const tab = e.target.closest('.blacklist-tab-btn');
        _handleBlacklistTabSwitch(tab);
        // Re-run search on tab switch if there's a query
        document.getElementById('blacklist-search-input').dispatchEvent(new Event('input'));
    });

    document.getElementById('blacklist-search-input').addEventListener('input', e => {
        const query = e.target.value.trim().toLowerCase();
        const activeTab = document.querySelector('.blacklist-tab-btn.active').dataset.tab;
        const contextKey = currentBlacklistContext;
        if (!contextKey) return;
        const blacklistSet = new Set(automationSettings[contextKey].blacklist || []);
        const allEligibleDecks = decks.filter(d => d.type !== 'General Study');

        const typeMap = { 'vocab': 'Vocabulary', 'expr': 'Expressions', 'sub': 'Subtitle' };
        const decksForTab = allEligibleDecks.filter(d => d.type === typeMap[activeTab]);
        const container = document.getElementById(`blacklist-${activeTab}-list`);
        
        _renderBlacklistDeckList(decksForTab, container, blacklistSet, query);
    });

    document.getElementById('save-blacklist-btn').addEventListener('click', () => {
        if (!currentBlacklistContext) return;

        const newBlacklist = Array.from(document.querySelectorAll('#blacklist-modal input[type="checkbox"]:checked'))
            .map(checkbox => checkbox.dataset.deckId);
        
        automationSettings[currentBlacklistContext].blacklist = newBlacklist;
        saveAutomationSettings();
        ui.showToast("Blacklist updated!");
        ui.closeAllModals(true);
    });

    document.body.addEventListener('click', e => {
        // --- NEW: Handle Blacklist Management Flow ---
        const manageBlacklistsBtn = e.target.closest('#manage-blacklists-btn');
        if (manageBlacklistsBtn) {
            ui.showModal(DOM.screens.blacklistContext);
            return;
        }

        const blacklistContextChoice = e.target.closest('#blacklist-context-modal .list-option');
        if (blacklistContextChoice) {
            const contextKey = blacklistContextChoice.dataset.blacklistContext;
            if (contextKey) {
                openBlacklistModal(contextKey);
            }
            return;
        }
        const blacklistBtn = e.target.closest('.blacklist-trigger-btn');
        if (blacklistBtn) {
            e.preventDefault();
            const parentContainerId = blacklistBtn.closest('.setting-card-sub').id;
            if (parentContainerId === 'instant-image-deck-settings-container') {
                openBlacklistModal('instantImageDeckTypes');
            } else if (parentContainerId === 'better-image-deck-settings-container') {
                openBlacklistModal('betterImageDeckTypes');
            } else if (parentContainerId === 'auto-defs-deck-settings-container') {
                openBlacklistModal('autoDefinitionsDeckTypes');
            }
            return;
        }
    });

        // --- Search & Import ---
                DOM.mainSearchInput.addEventListener('input', () => {
            const query = DOM.mainSearchInput.value.trim().toLowerCase();
            ui.handleSearch(query, decks, folders); // THE FIX
        });
        DOM.searchResultsContainer.addEventListener('click', handleSearchResultClick);
                document.getElementById('import-file-input').addEventListener('change', deckManager.handleFileImport);

        // --- NEW: Eruda Developer Console Activation & Deactivation ---
               // --- NEW: Listen for global toast events dispatched from other modules ---
        document.body.addEventListener('show-toast', (e) => {
            const { message, isError, id, persistent } = e.detail;
            ui.showToast(message, isError, id, persistent);
        });
        document.body.addEventListener('hide-toast', (e) => {
            ui.hideToast(e.detail.id);
        }); document.getElementById('about-btn').addEventListener('click', () => {
            aboutTapCount++;
            
            if (aboutTapTimer) clearTimeout(aboutTapTimer);

            if (aboutTapCount === 3) {
                if (typeof eruda !== 'undefined') {
                    if (!isErudaActive) {
                        console.log("Developer mode activated. Initializing Eruda console.");
                        eruda.init();
                        isErudaActive = true;
                        localStorage.setItem('wordwiseErudaActive', 'true'); // THE FIX: Save state
                    } else {
                        console.log("Developer mode deactivated. Destroying Eruda console.");
                        eruda.destroy();
                        isErudaActive = false;
                        localStorage.setItem('wordwiseErudaActive', 'false'); // THE FIX: Save state
                    }
                } else {
                    ui.showToast("Eruda library not found.", true);
                }
                aboutTapCount = 0; // Reset counter after action
            } else {
                aboutTapTimer = setTimeout(() => {
                    aboutTapCount = 0;
                }, 600); // 600ms window for triple-tapping
            }
        });
    }

// --- NEW: Handle popover realignment on screen resize ---
        window.addEventListener('resize', debounce(() => {
            // Check if the Decks sort popover is visible
            if (deckSortPopover.classList.contains('visible')) {
                const contentContainer = DOM.deckViewContainer;
                const popoverContainer = deckSortPopover.parentElement;
                const contentRect = contentContainer.getBoundingClientRect();
                const containerRect = popoverContainer.getBoundingClientRect();
                const newLeftPosition = contentRect.left - containerRect.left;
                deckSortPopover.style.left = `${newLeftPosition}px`;
            }
            // Check if the Explore sort popover is visible
            if (exploreSortPopover.classList.contains('visible')) {
                const contentSection = document.querySelector('#explore-list-screen .content-section');
                const popoverContainer = exploreSortPopover.parentElement;
                const contentRect = contentSection.getBoundingClientRect();
                const containerRect = popoverContainer.getBoundingClientRect();
                const newLeftPosition = contentRect.left - containerRect.left;
                exploreSortPopover.style.left = `${newLeftPosition}px`;
            }
        }, 100)); // 100ms debounce delay

    
    function renderGlobalStats() {
        const stats = scoring.calculateGlobalProficiency(decks, quiz.getQuizHistory());

        // Main Score
        document.getElementById('stats-proficiency-score').textContent = stats.score;
        document.getElementById('stats-proficiency-rank').textContent = stats.rank;
        const scoreCircle = document.getElementById('main-score-circle');
        scoreCircle.style.background = `conic-gradient(var(--accent-primary) ${stats.score * 3.6}deg, var(--bg-subtle) 0deg)`;

        // Sub-Scores
        document.getElementById('stats-memory-score').textContent = stats.memory.score;
        document.getElementById('stats-accuracy-score').textContent = stats.accuracy.score;
        document.getElementById('stats-consistency-score').textContent = stats.consistency.score;

        // Key Statistics
        document.getElementById('stats-total-words').textContent = stats.totalWords;
        document.getElementById('stats-mastered-words').textContent = stats.memory.masteredWords;
        document.getElementById('stats-quizzes-taken').textContent = stats.accuracy.quizzesTaken;
        document.getElementById('stats-current-streak').textContent = `${stats.consistency.streak}d`;

        // Breakdown Chart
        const breakdownContainer = document.getElementById('stats-breakdown-container');
        breakdownContainer.innerHTML = '';
        if (stats.breakdown && Object.keys(stats.breakdown).length > 0) {
            for (const type in stats.breakdown) {
                const score = stats.breakdown[type];
                breakdownContainer.innerHTML += `
                    <div class="breakdown-bar-container">
                        <p class="breakdown-label">${type}</p>
                        <div class="breakdown-progress-bar"><div class="breakdown-progress-fill" style="width: ${score}%;"></div></div>
                        <p class="breakdown-value">${score}</p>
                    </div>`;
            }
        } else {
            breakdownContainer.innerHTML = '<p class="no-results-message" style="padding: 0;">No typed decks to analyze.</p>';
        }

        // Activity Heatmap
        const heatmapContainer = document.getElementById('stats-activity-heatmap');
        heatmapContainer.innerHTML = '';
        const today = new Date();
        const ninetyDaysAgo = new Date(today);
        ninetyDaysAgo.setDate(today.getDate() - 89);
        ninetyDaysAgo.setHours(0, 0, 0, 0);

        for (let i = 0; i < 90; i++) {
            const date = new Date(ninetyDaysAgo);
            date.setDate(ninetyDaysAgo.getDate() + i);
            const dateString = date.toISOString().split('T')[0];
            const activityCount = stats.consistency.activityData.get(dateString) || 0;
            let level = 0;
            if (activityCount > 20) level = 4;
            else if (activityCount > 10) level = 3;
            else if (activityCount > 5) level = 2;
            else if (activityCount > 0) level = 1;
            heatmapContainer.innerHTML += `<div class="heatmap-day" data-level="${level}" title="${date.toDateString()}: ${activityCount} activities"></div>`;
        }

        renderJourneyChart(); // <-- ADD THIS CALL
        ui.showModal(DOM.screens.proficiencyStats);
    }

        function renderJourneyChart() {
        const svg = document.getElementById('stats-journey-chart');
        const emptyState = document.getElementById('journey-chart-empty-state');
        svg.innerHTML = '';

        let data = proficiencyLog;
        if (currentChartFilterDays > 0) {
            const cutoffDate = new Date().setDate(new Date().getDate() - currentChartFilterDays);
            data = proficiencyLog.filter(entry => entry.timestamp >= cutoffDate);
        }

        const width = svg.clientWidth;
        const height = svg.clientHeight;
        const padding = { top: 10, right: 0, bottom: 20, left: 30 };

        // --- NEW LOGIC TO HANDLE ALL CASES ---

        if (data.length === 0) {
            // Case 1: No data at all. Show empty state.
            emptyState.style.display = 'flex';
            return;
        } 
        
        emptyState.style.display = 'none';
        const mapY = (score) => height - padding.bottom - (score / 100) * (height - padding.top - padding.bottom);

        if (data.length === 1) {
            // Case 2: Only one data point. Show a single dot.
            const point = data[0];
            const cx = padding.left + (width - padding.left - padding.right) / 2; // Center the dot
            const cy = mapY(point.score);

            svg.innerHTML = `
                <g class="y-axis-labels">
                    <text x="5" y="${padding.top + 5}" fill="var(--text-tertiary)" font-size="10">100</text>
                    <text x="5" y="${mapY(50)}" fill="var(--text-tertiary)" font-size="10">50</text>
                    <text x="5" y="${height - padding.bottom}" fill="var(--text-tertiary)" font-size="10">0</text>
                </g>
                <circle cx="${cx}" cy="${cy}" r="4" fill="var(--accent-primary)" />
                <g class="x-axis-labels">
                    <text x="${cx}" y="${height - 5}" text-anchor="middle" fill="var(--text-tertiary)" font-size="10">${new Date(point.timestamp).toLocaleDateString()}</text>
                </g>
            `;
        } else {
            // Case 3: Two or more data points. Draw the full chart.
            const minDate = data[0].timestamp;
            const maxDate = data[data.length - 1].timestamp;
            const mapX = (ts) => padding.left + (ts - minDate) / (maxDate - minDate) * (width - padding.left - padding.right);

            let pathD = `M ${mapX(data[0].timestamp)},${mapY(data[0].score)}`;
            data.forEach(p => pathD += ` L ${mapX(p.timestamp)},${mapY(p.score)}`);
            
            const lastPoint = data[data.length - 1];
            const areaD = `${pathD} L ${mapX(lastPoint.timestamp)},${height - padding.bottom} L ${mapX(data[0].timestamp)},${height - padding.bottom} Z`;

            svg.innerHTML = `
                <defs>
                    <linearGradient id="area-gradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="var(--accent-primary)" stop-opacity="0.4"/>
                        <stop offset="100%" stop-color="var(--accent-primary)" stop-opacity="0"/>
                    </linearGradient>
                </defs>
                <g class="y-axis-labels">
                    <text x="5" y="${padding.top + 5}" fill="var(--text-tertiary)" font-size="10">100</text>
                    <text x="5" y="${mapY(50)}" fill="var(--text-tertiary)" font-size="10">50</text>
                    <text x="5" y="${height - padding.bottom}" fill="var(--text-tertiary)" font-size="10">0</text>
                </g>
                <g class="x-axis-labels">
                    <text x="${padding.left}" y="${height - 5}" fill="var(--text-tertiary)" font-size="10">${new Date(minDate).toLocaleDateString()}</text>
                    <text x="${width - padding.right}" y="${height - 5}" text-anchor="end" fill="var(--text-tertiary)" font-size="10">${new Date(maxDate).toLocaleDateString()}</text>
                </g>
                <path d="${areaD}" fill="url(#area-gradient)" />
                <path d="${pathD}" fill="none" stroke="var(--accent-primary)" stroke-width="2" />
            `;
        }
    }

        // --- NEW: Favorite Word Logic ---
    function handleToggleFavorite(deckId, wordText) {
        const FAVORITES_DECK_ID = 'favorites_deck';
        
        const clickedDeck = decks.find(d => d.id === deckId);
        if (!clickedDeck) return;
        const clickedWord = clickedDeck.words.find(w => w.text === wordText);
        if (!clickedWord) return;

        // 1. Determine the NEW favorite status
        const newFavoriteStatus = !clickedWord.isFavorite;

        // 2. THE FIX: Synchronize this new status across ALL instances of the word
        decks.forEach(deck => {
            deck.words.forEach(word => {
                if (word.text.toLowerCase() === wordText.toLowerCase()) {
                    word.isFavorite = newFavoriteStatus;
                }
            });
        });

        // 3. Find or create the "Favorites" deck
        let favoritesDeck = decks.find(d => d.id === FAVORITES_DECK_ID);
        if (newFavoriteStatus && !favoritesDeck) {
            favoritesDeck = {
                id: FAVORITES_DECK_ID,
                title: "Favorites",
                description: "A collection of your favorite words and expressions.",
                words: [],
                type: null, // No type for the Favorites deck
                isSpecial: false, // Treat it as a normal, editable deck
                imageUrl: 'https://previews.123rf.com/images/faysalfarhan/faysalfarhan1504/faysalfarhan150400087/38176968-favorite-star-icon-yellow-square-button.jpg',
                createdAt: new Date().toISOString()
            };
            decks.unshift(favoritesDeck);
        }

        // 4. Add or remove the word from the Favorites deck based on the new status
        if (favoritesDeck) {
            const wordIndexInFavorites = favoritesDeck.words.findIndex(w => w.text.toLowerCase() === wordText.toLowerCase());
            
            if (newFavoriteStatus) {
                if (wordIndexInFavorites === -1) {
                    const wordCopy = JSON.parse(JSON.stringify(clickedWord)); // Make a fresh copy
                    // --- THE FIX: Store the original deck's type on the new copy ---
                    wordCopy.originType = clickedDeck.type; 
                    favoritesDeck.words.push(wordCopy);
                    ui.showToast(`Added "${wordText}" to Favorites.`);
                }
            } else {
                if (wordIndexInFavorites > -1) {
                    favoritesDeck.words.splice(wordIndexInFavorites, 1);
                    ui.showToast(`Removed "${wordText}" from Favorites.`);
                    if (favoritesDeck.words.length === 0) {
                        decks = decks.filter(d => d.id !== FAVORITES_DECK_ID);
                    }

                    // --- THE FIX: Refresh the deck viewer if we are in the Favorites deck ---
                    const currentlyViewedDeck = deckViewer.getCurrentDeck();
                    if (currentlyViewedDeck && currentlyViewedDeck.id === FAVORITES_DECK_ID) {
                        // Re-open the deck, which will automatically select and display the next word.
                        // Pass the updated deck object to ensure it has the latest word list.
                        const updatedFavoritesDeck = decks.find(d => d.id === FAVORITES_DECK_ID);
                        deckViewer.openDeck(updatedFavoritesDeck || { ...clickedDeck, words: [] });
                    }
                }
            }
        }
        
        // 5. Save and update UI silently
        saveDecksToStorage();
        
        const allFavoriteButtons = document.querySelectorAll(`.favorite-toggle-btn[data-word-text="${wordText}"]`);
        allFavoriteButtons.forEach(btn => {
            const icon = btn.querySelector('i');
            if (icon) {
                icon.className = newFavoriteStatus ? 'ph-fill ph-star' : 'ph ph-star';
            }
        });
        
        renderDeckScreen(); // This is needed to update deck counts, but doesn't cause a screen flash
    }


    // This is a new function to add.

    async function openGoogleSearchModal(searchTerm) {
        // Add new modal to the DOM object if it's not there
        if (!DOM.screens.googleSearch) {
            DOM.screens.googleSearch = document.getElementById('google-search-modal');
        }

        ui.showModal(DOM.screens.googleSearch);
        const contentArea = document.getElementById('google-search-content');
        const modalTitle = document.getElementById('google-search-modal-title');
        modalTitle.textContent = `Search for "${searchTerm}"`;

        // Clear previous results and show a loader
        contentArea.innerHTML = '<div class="no-results-message" style="padding-top: 3rem;">Loading Google Search...</div>';

        try {
            const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
            const supabase = createClient(supabaseUrl, supabaseAnonKey);

            const { data, error } = await supabase.from('api_keys').select('api_key').eq('service', 'google-cse').eq('name', 'CX_ID');
            if (error) throw new Error(`Supabase error: ${error.message}`);
            if (!data || data.length === 0) throw new Error("CX_ID not found in Supabase api_keys table.");
            
            const cxKey = data[0].api_key;
            
            // --- THE FIX: Implement the official CSE API method ---
            const finalQuery = `definition of ${searchTerm}`;

            // Restore the placeholder with the gname attribute
            contentArea.innerHTML = '<div class="gcse-search" data-gname="wordwise-search"></div>';
            
            // This function polls until the CSE element is ready, then executes the search
            function tryExecuteSearch() {
                if (window.google && google.search && google.search.cse && google.search.cse.element) {
                    const cseElement = google.search.cse.element.getElement('wordwise-search');
                    if (cseElement) {
                        cseElement.prefillQuery(finalQuery);
                        cseElement.execute(finalQuery);
                    } else {
                        setTimeout(tryExecuteSearch, 250); // Element not ready yet, try again
                    }
                } else {
                    setTimeout(tryExecuteSearch, 250); // CSE script not ready yet, try again
                }
            }

            // Load the script only once
            if (!isCseScriptLoaded) {
                const script = document.createElement('script');
                script.src = `https://cse.google.com/cse.js?cx=${cxKey}`;
                script.async = true;
                script.onload = () => {
                    console.log("Google CSE script loaded successfully.");
                    isCseScriptLoaded = true;
                    // Start polling to execute the search once the element is initialized
                    tryExecuteSearch();
                };
                document.body.appendChild(script);
            } else {
                // If script is already loaded, render the element and then start the search
                google.search.cse.element.render({ div: contentArea.querySelector('.gcse-search'), tag: 'search' });
                tryExecuteSearch();
            }
        } catch (error) {
            console.error("Failed to load Google Search:", error);
            contentArea.innerHTML = `<div class="no-results-message" style="padding: 3rem;">
                <p style="font-weight: 600;">Could not load Google Search</p>
                <p>${error.message}</p>
            </div>`;
        }
    }

    function handleDeleteWordFromDeck(deckId, wordText) {
        const deck = decks.find(d => d.id === deckId);
        if (!deck) return;

        const wordIndex = deck.words.findIndex(w => w.text === wordText);
        if (wordIndex > -1) {
            deck.words.splice(wordIndex, 1);
            saveDecksToStorage();
            ui.showToast(`"${wordText}" was deleted.`);
            // Also refresh the main decks screen to update the word count
            renderDeckScreen();
        }
    }

async function promptForNewName(originalName) {
        let newName = null;
        while (true) {
            const suggestedName = newName ? newName : `${originalName} (Copy)`;
            newName = prompt(`Please enter a new name for the deck:`, suggestedName);
            
            if (newName === null) { // User clicked cancel
                return null;
            }
            
            newName = newName.trim();
            if (newName === "") {
                alert("Deck name cannot be empty.");
                continue;
            }

            const isDuplicate = decks.some(d => d.title.toLowerCase() === newName.toLowerCase());
            if (isDuplicate) {
                alert(`A deck named "${newName}" already exists. Please choose a different name.`);
            } else {
                return newName; // Valid, non-duplicate name found
            }
        }
    }

    async function handleRefetchWordImage(wordObject, deckObject) {
        const toastId = 'ai-image-refetch';
        try {
            ui.showToast("AI is generating a new search query...", false, toastId, true);
            
            const populatedWord = await populateWordData(api, currentApiKeys, wordObject, deckObject);
            const context = populatedWord.definitions.flashcard || `The word is "${populatedWord.text}".`;
            const previousQuery = populatedWord.image_query || 'none';

            // Ask the AI for a NEW search term, telling it what the last one was.
            const searchTermPrompt = `You are an AI that generates effective search terms for image APIs like Unsplash. Your goal is to find a NEW and DIFFERENT image. The previous search query was "${previousQuery}". Based on the following word and its definition, provide a single, concise, and visually descriptive search term (2-4 words is ideal) that is different from the previous one. Respond with ONLY the search term itself, no quotes or extra text.

Word: "${populatedWord.text}"
Definition: "${context}"`;

            const searchTerm = await api.getGroqCompletion([{ role: 'user', content: searchTermPrompt }]);
            if (!searchTerm) throw new Error("AI did not provide a search term.");
            
            ui.showToast(`AI is searching for "${searchTerm}"...`, false, toastId, true);

            const chosenImageUrl = await getBestImageForQuery(searchTerm, context);
            
            if (chosenImageUrl) {
                populatedWord.imageUrl = chosenImageUrl;
                populatedWord.image_query = searchTerm; // Save the new query
                populatedWord.isImageProvisional = false; // Mark as permanent
                saveDecksToStorage();
                
                // Re-render the deck viewer with the new image
                deckViewer.openDeck(deckObject, populatedWord.text);

                ui.hideToast(toastId);
                ui.showToast("New image assigned successfully!");
            } else {
                throw new Error("AI couldn't find a suitable image for that search term.");
            }
        } catch (error) {
            ui.hideToast(toastId);
            ui.showToast(error.message, true);
            console.error("Error refetching image with AI:", error);
        }
    }

    function handleLogProficiency(force = false) {
        // This function now prevents logging too frequently for regular study,
        // but can be forced by significant events like a quiz.
        if (!force) {
            const lastLog = proficiencyLog[proficiencyLog.length - 1];
            const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
            if (lastLog && (Date.now() - lastLog.timestamp < TWENTY_FOUR_HOURS_MS)) {
                return; // It's too soon to log again from regular study.
            }
        }

        const currentStats = scoring.calculateGlobalProficiency(decks, quiz.getQuizHistory());
        proficiencyLog.push({
            timestamp: Date.now(),
            score: currentStats.score
        });
        saveProficiencyLog();
    }

async function handleUploadDeck(deckId) {
    console.log(`[Upload] Starting upload process for deck ID: ${deckId}`);
    const deckToUpload = decks.find(d => d.id === deckId);
    if (!deckToUpload) {
        ui.showToast("Could not find the deck to upload.", true);
        console.error("[Upload] Deck not found in local state.");
        return;
    }

    // --- NEW: UPLOAD VALIDATION CHECKS ---
    if (!deckToUpload.description) {
        ui.showToast("Please add a description to this deck before uploading.", true);
        return;
    }
    if (!deckToUpload.imageUrl) {
        ui.showToast("Please assign a cover image to this deck before uploading.", true);
        return;
    }
    if (!deckToUpload.words || deckToUpload.words.length < 5) {
        ui.showToast("Decks must contain at least 5 words to be uploaded.", true);
        return;
    }
    // --- END: UPLOAD VALIDATION CHECKS ---

    if (!supabaseUrl || !supabaseAnonKey) {
        ui.showToast("Supabase credentials required for uploading.", true);
        console.error("[Upload] Supabase credentials not set.");
        return;
    }

    const confirmed = await actions.showConfirmation({
        title: `Upload "${deckToUpload.title}"?`,
        message: "This will make your deck available to all other WordWise users in the public library.",
        confirmText: "Upload",
        iconClass: "ph-fill ph-upload-simple"
    });
    if (!confirmed) {
        console.log("[Upload] User cancelled the operation.");
        return;
    }

    const toastId = 'deck-upload';
    ui.showToast("Uploading deck...", false, toastId, true);
    console.log("[Upload] Sanitizing deck data...");

    // Sanitize the words array for public upload
    const sanitizedWords = deckToUpload.words.map(word => ({
        text: word.text,
        definitions: {
            flashcard: word.definitions.flashcard || null,
            detailed: word.definitions.detailed || null,
            gemini: word.definitions.gemini || null // ADDED: Amharic definition
        },
        // Only include the image URL if it's permanent (not a provisional search result)
        imageUrl: word.isImageProvisional ? null : word.imageUrl,
        image_query: word.image_query || null,
        example: word.example || null,
        note: word.note || null, // ADDED: Personal note
        tags: word.tags || []      // ADDED: Tags array
    }));

    // This is the object that will be inserted as a new row in the table
const payload = {
    title: deckToUpload.title,
    description: deckToUpload.description,
    type: deckToUpload.type,
    image_url: deckToUpload.imageUrl,
    image_query: deckToUpload.image_query || null, // THE FIX
    word_count: sanitizedWords.length,
    words: sanitizedWords
    // We don't set 'uploader_id' here; RLS policies can handle it if needed.
};
    console.log("[Upload] Payload created:", payload);

    // --- DIRECT TABLE INSERT LOGIC ---
    const tableName = 'published_decks';
    const apiUrl = `${supabaseUrl}/rest/v1/${tableName}`;
    console.log(`[Upload] Preparing to POST to: ${apiUrl}`);

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'apikey': supabaseAnonKey,
                'Authorization': `Bearer ${supabaseAnonKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal' // We don't need the created object back
            },
            body: JSON.stringify(payload)
        });

        console.log(`[Upload] Fetch response received with status: ${response.status}`);

        if (!response.ok) {
            // If the response is not OK, try to get more details from the body
            const errorData = await response.json();
            console.error("[Upload] API Error Data:", errorData);
            throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
        }

        // If we reach here, the upload was successful (status 201 Created)
        ui.hideToast(toastId);
        ui.showToast(`Deck "${deckToUpload.title}" uploaded successfully!`);
        console.log("[Upload] Success!");

    } catch (error) {
        ui.hideToast(toastId);
        ui.showToast(`Upload failed: ${error.message}`, true);
        console.error("[Upload] Fetch request failed:", error);
    }
}

async function showExploreDecksScreen() {
        ui.showModal(DOM.screens.exploreList);
        const grid = document.getElementById('published-deck-grid');
        grid.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Loading deck library...</p>';

        // --- NEW: Enhanced Pre-flight Checks and Error Handling ---

        // 1. Check for Supabase credentials first
        if (!supabaseUrl || !supabaseAnonKey) {
            grid.innerHTML = `<div class="no-results-message">
                <i class="ph ph-plugs-connected" style="font-size: 3rem; margin-bottom: 0.5rem;"></i>
                <p style="font-weight: 600;">Backend Not Configured</p>
                <p>Please add your Supabase URL and Key in the Settings tab to access the public deck library.</p>
            </div>`;
            return;
        }

        // 2. Check for internet connection
        if (!navigator.onLine) {
            grid.innerHTML = `<div class="no-results-message">
                <i class="ph ph-wifi-slash" style="font-size: 3rem; margin-bottom: 0.5rem;"></i>
                <p style="font-weight: 600;">You are Offline</p>
                <p>An internet connection is required to browse the deck library.</p>
            </div>`;
            return;
        }

        const tableName = 'published_decks';
        const apiUrl = `${supabaseUrl}/rest/v1/${tableName}?select=*&order=downloads.desc,created_at.desc`;

        try {
            const response = await fetch(apiUrl, {
                headers: { 'apikey': supabaseAnonKey, 'Authorization': `Bearer ${supabaseAnonKey}` }
            });

            if (!response.ok) {
                // Try to parse the error for a more specific message
                try {
                    const errorData = await response.json();
                    throw new Error(errorData.message || `An unknown server error occurred (Status: ${response.status}).`);
                } catch (jsonError) {
                    // This happens if the error response itself isn't valid JSON (e.g., gateway error)
                    throw new Error(`The server responded unexpectedly (Status: ${response.status}). Please try again later.`);
                }
            }

            const data = await response.json();
            publicDecks = data || [];
            applyPublicDeckSortAndFilter(); // Use the sort/filter function to render

        } catch (error) {
            console.error("[Explore] Fetch request failed:", error);
            // Translate the raw error into a user-friendly message
            let userMessage = `Could not load the library. ${error.message}`;
            if (error.message.includes("failed to fetch")) {
                userMessage = "A network error occurred. Please check your connection and Supabase URL.";
            } else if (error.message.includes("Unexpected end of JSON input")) {
                userMessage = "Received an incomplete response from the server. Please try again.";
            }

            grid.innerHTML = `<div class="no-results-message">
                <i class="ph ph-warning-circle" style="font-size: 3rem; margin-bottom: 0.5rem;"></i>
                <p style="font-weight: 600;">An Error Occurred</p>
                <p>${userMessage}</p>
            </div>`;
        }
    }

// --- NEW: EXPLORE SCREEN SORT/FILTER LOGIC ---
        const exploreSortToggleBtn = document.getElementById('explore-sort-toggle-btn');
        const exploreSortPopover = document.getElementById('explore-sort-popover');

        const applyPublicDeckSortAndFilter = () => {
            let processedDecks = [...publicDecks];
            const { sort, filter } = publicDecksSortAndFilter;

            // 1. Apply Filters
            if (filter.type !== 'type_all') {
                if (filter.type === 'source_ai') {
                    processedDecks = processedDecks.filter(d => d.is_ai_generated === true);
                } else if (filter.type === 'source_user') {
                    // Assuming user-submitted decks will have is_ai_generated as false or null
                    processedDecks = processedDecks.filter(d => !d.is_ai_generated);
                } else {
                    const typeMap = { type_vocab: 'Vocabulary', type_expr: 'Expressions', type_sub: 'Subtitle' };
                    processedDecks = processedDecks.filter(d => d.type === typeMap[filter.type]);
                }
            }
            if (filter.size) {
                const { op, val1, val2 } = filter.size;
                const num1 = parseInt(val1, 10);
                const num2 = parseInt(val2, 10);
                processedDecks = processedDecks.filter(d => {
                    if (op === 'gte') return d.word_count >= num1;
                    if (op === 'lte') return d.word_count <= num1;
                    if (op === 'eq') return d.word_count === num1;
                    if (op === 'between') return d.word_count >= num1 && d.word_count <= num2;
                    return true;
                });
            }

            // 2. Apply Sorting
            processedDecks.sort((a, b) => {
                switch (sort) {
                    case 'date_asc': return new Date(a.created_at) - new Date(b.created_at);
                    case 'name_asc': return a.title.localeCompare(b.title);
                    case 'name_desc': return b.title.localeCompare(a.title);
                    case 'date_desc':
                    default:
                        return new Date(b.created_at) - new Date(a.created_at);
                }
            });

            renderPublishedDecks(processedDecks);
        };
        
        const updateSortUI = () => {
            const { sort, filter } = publicDecksSortAndFilter;
            exploreSortToggleBtn.querySelector('i').className = sort.includes('_asc') ? 'ph ph-sort-ascending' : 'ph ph-sort-descending';
            const hasFilter = filter.type !== 'type_all' || filter.size !== null;
            exploreSortToggleBtn.classList.toggle('has-filter', hasFilter);

            exploreSortPopover.querySelectorAll('.sort-item.active').forEach(el => el.classList.remove('active'));
            exploreSortPopover.querySelectorAll('.active-indicator').forEach(el => el.textContent = '');

            const activeSortItem = exploreSortPopover.querySelector(`.sort-item[data-sort="${sort}"]`);
            if (activeSortItem) {
                activeSortItem.classList.add('active');
                const indicator = activeSortItem.closest('[data-sort-group]').querySelector('.active-indicator');
                if(indicator) indicator.textContent = `(${activeSortItem.querySelector('span').textContent})`;
            }
            const activeFilterTypeItem = exploreSortPopover.querySelector(`.sort-item[data-sort="${filter.type}"]`);
            if (activeFilterTypeItem) {
                activeFilterTypeItem.classList.add('active');
                if (filter.type !== 'type_all') {
                    const indicator = activeFilterTypeItem.closest('[data-sort-group]').querySelector('.active-indicator');
                    if(indicator) indicator.textContent = `(${activeFilterTypeItem.querySelector('span').textContent})`;
                }
            }
            if (filter.size) {
                const indicator = exploreSortPopover.querySelector('[data-sort-group="size"] .active-indicator');
                if (indicator) {
                    const { op, val1, val2 } = filter.size;
                    let text = '';
                    if (op === 'gte') text = `> ${val1}`; else if (op === 'lte') text = `< ${val1}`;
                    else if (op === 'eq') text = `= ${val1}`; else if (op === 'between') text = `${val1}-${val2}`;
                    indicator.textContent = `(${text})`;
                }
            } else {
                const allSizesItem = exploreSortPopover.querySelector('.sort-item[data-sort="size_all"]');
                if (allSizesItem) allSizesItem.classList.add('active');
            }
        };

        const closeSortMenu = () => {
            exploreSortPopover.classList.remove('visible');
            exploreSortToggleBtn.classList.remove('active');
        };

        exploreSortToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = exploreSortPopover.classList.toggle('visible');
            exploreSortToggleBtn.classList.toggle('active', isVisible);

            // --- THE FIX: Align popover with the main content area ---
            if (isVisible) {
                // 1. Get the main content section for the explore screen.
                const contentSection = document.querySelector('#explore-list-screen .content-section');
                if (!contentSection) return;

                // 2. Get the positioning container of the popover (its parent).
                const popoverContainer = exploreSortPopover.parentElement;

                // 3. Get the absolute screen positions of both elements.
                const contentRect = contentSection.getBoundingClientRect();
                const containerRect = popoverContainer.getBoundingClientRect();

                // 4. Calculate the required left offset for the popover.
                //    (Content's screen position - Popover container's screen position)
                const newLeftPosition = contentRect.left - containerRect.left;

                // 5. Apply the new static position.
                exploreSortPopover.style.left = `${newLeftPosition}px`;
                exploreSortPopover.style.right = 'auto'; // Ensure right alignment is cleared
                exploreSortPopover.style.transformOrigin = 'top left'; // Animate from the top-left corner
            }
        });

        // --- NEW, MORE ROBUST "CLICK OUTSIDE" LISTENER ---
        DOM.screens.exploreList.addEventListener('click', (e) => {
            // Check if the sort popover is visible AND if the click was NOT on the toggle button or inside the popover itself
            if (exploreSortPopover.classList.contains('visible') && !e.target.closest('#explore-sort-toggle-btn') && !e.target.closest('#explore-sort-popover')) {
                closeSortMenu();
            }
        });
        
        exploreSortPopover.addEventListener('mouseover', (e) => {
            const parentItem = e.target.closest('.sort-item:has(.sort-submenu)');
            if (!parentItem) return;
            exploreSortPopover.querySelectorAll('.sort-submenu.visible').forEach(s => {
                if (!parentItem.contains(s)) s.classList.remove('visible');
            });
            const submenu = parentItem.querySelector('.sort-submenu');
            if (!submenu || submenu.classList.contains('visible')) return;
            const parentRect = parentItem.getBoundingClientRect();
            if (parentRect.right + submenu.offsetWidth > window.innerWidth) {
                submenu.classList.add('opens-left'); submenu.classList.remove('opens-right');
            } else {
                submenu.classList.add('opens-right'); submenu.classList.remove('opens-left');
            }
            submenu.classList.add('visible');
        });
        exploreSortPopover.addEventListener('mouseleave', () => {
             exploreSortPopover.querySelectorAll('.sort-submenu.visible').forEach(s => s.classList.remove('visible'));
        });

        exploreSortPopover.addEventListener('click', (e) => {
            const clickedItem = e.target.closest('.sort-item');
            if (!clickedItem || clickedItem.querySelector('.sort-submenu') || clickedItem.closest('form')) return;
            const sortKey = clickedItem.dataset.sort;
            if (sortKey) {
                if (sortKey.startsWith('type_') || sortKey.startsWith('source_')) {
                    publicDecksSortAndFilter.filter.type = sortKey;
                } else if (sortKey === 'size_all') {
                    publicDecksSortAndFilter.filter.size = null;
                } else {
                    publicDecksSortAndFilter.sort = sortKey;
                }
                applyPublicDeckSortAndFilter();
                updateSortUI();
                closeSortMenu();
            }
        });

        document.getElementById('explore-clear-filters-btn').addEventListener('click', () => {
             publicDecksSortAndFilter = { sort: 'date_desc', filter: { type: 'type_all', size: null } };
             applyPublicDeckSortAndFilter();
             updateSortUI();
             closeSortMenu();
        });

        const sizeOperatorEl = document.getElementById('explore-size-operator');
        sizeOperatorEl.addEventListener('change', () => {
            document.getElementById('explore-size-value-2-wrapper').style.display = sizeOperatorEl.value === 'between' ? 'flex' : 'none';
        });
        document.getElementById('explore-sort-by-size-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const val1 = document.getElementById('explore-size-value-1').value;
            const val2 = document.getElementById('explore-size-value-2').value;
            if (!val1 || (sizeOperatorEl.value === 'between' && !val2)) return;
            publicDecksSortAndFilter.filter.size = { op: sizeOperatorEl.value, val1, val2 };
            applyPublicDeckSortAndFilter();
            updateSortUI();
            closeSortMenu();
        });

    function renderPublishedDecks(decksToRender) {
        const grid = document.getElementById('published-deck-grid');
        if (!decksToRender || decksToRender.length === 0) {
            grid.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No public decks found.</p>';
            return;
        }

        grid.innerHTML = decksToRender.map(deck => `
            <div class="published-deck-card" data-deck-id="${deck.id}">
                <div class="published-deck-image" style="background-image: url('${deck.image_url}')"></div>
                <div class="published-deck-content">
                    <h3 class="published-deck-title">${deck.title}</h3>
                    <p class="published-deck-desc">${deck.description}</p>
                    <div class="published-deck-meta">
                        <div class="meta-item"><i class="ph ph-text-t"></i><span>${deck.word_count} words</span></div>
                        <div class="meta-item"><i class="ph ph-download-simple"></i><span>${(deck.downloads || 0).toLocaleString()}</span></div>
                        <div class="meta-item"><i class="ph ph-tag"></i><span>${deck.type}</span></div>
                        <div class="meta-item"><i class="ph ph-clock"></i><span>${formatRelativeTime(deck.created_at)}</span></div>
                    </div>
                </div>
            </div>
        `).join('');
    }

    function showExploreDetailScreen(deckId) {
        currentPublicDeck = publicDecks.find(d => d.id === deckId);
        if (!currentPublicDeck) return;

        ui.showModal(DOM.screens.exploreDetail); // This will need to be added to DOM object
        document.getElementById('deck-detail-title-explore').textContent = currentPublicDeck.title;
        
        const wordContainer = document.getElementById('word-list-container');
        wordContainer.innerHTML = currentPublicDeck.words.map(word => {
            const imageHtml = word.imageUrl ? `<div class="word-item-image" style="background-image: url('${word.imageUrl}')"></div>` : `<div class="word-item-image"></div>`;
            const exampleHtml = word.example ? `<p class="word-item-example">"${word.example}"</p>` : '';

            return `
                <div class="word-item-card">
                    ${imageHtml}
                    <div class="word-item-content">
                        <h4 class="word-item-term">${word.text}</h4>
                        <p class="word-item-def">${word.definitions.flashcard}</p>
                        ${exampleHtml}
                    </div>
                </div>
            `;
        }).join('');
    }

    function handleImportPublicDeck() {
        if (!currentPublicDeck) return;

        const existingDeck = decks.find(d => d.title.toLowerCase() === currentPublicDeck.title.toLowerCase());

        if (existingDeck) {
            // CONFLICT DETECTED: Show the new modal
            document.getElementById('conflict-summary').textContent = `A deck named "${currentPublicDeck.title}" already exists. How would you like to proceed?`;
            document.getElementById('rename-deck-section').style.display = 'none'; // Hide rename section initially
            ui.showModal(DOM.screens.importConflict);
            return;
        }

        // NO CONFLICT: Proceed with the original import logic
        importDeckAsNew(currentPublicDeck.title);
    }

function handleMergeWithExisting() {
        const existingDeck = decks.find(d => d.title.toLowerCase() === currentPublicDeck.title.toLowerCase());
        if (!existingDeck) return;

        const existingWordTexts = new Set(existingDeck.words.map(w => w.text.toLowerCase()));
        let newWordsAdded = 0;

        currentPublicDeck.words.forEach(publicWord => {
            if (!existingWordTexts.has(publicWord.text.toLowerCase())) {
                const newWord = {
                    ...createNewSrsWord(publicWord.text),
                    definitions: publicWord.definitions,
                    example: publicWord.example,
                    imageUrl: publicWord.imageUrl,
                    isImageProvisional: !publicWord.imageUrl,
                    note: publicWord.note,
                    tags: publicWord.tags,
                    image_query: publicWord.image_query || null // ADD THIS LINE
                };
                existingDeck.words.push(newWord);
                newWordsAdded++;
            }
        });

        saveDecksToStorage();
        api.callSupabaseFunction('increment-deck-download', { deck_id: currentPublicDeck.id }).catch(console.error);

        ui.showToast(`Merged ${newWordsAdded} new word(s) into "${existingDeck.title}".`);
        ui.closeAllModals();
        renderDeckScreen();
        ui.showMainScreen(DOM.screens.decks, DOM.navLinks.decks);
    }

    function handleSaveRenamedDeck() {
        const newTitle = document.getElementById('conflict-rename-input').value.trim();
        if (!newTitle) {
            ui.showToast("Please enter a new name for the deck.", true);
            return;
        }
        if (decks.some(d => d.title.toLowerCase() === newTitle.toLowerCase())) {
            ui.showToast(`A deck named "${newTitle}" already exists. Please choose a different name.`, true);
            return;
        }

        // Import the deck with the new title
        importDeckAsNew(newTitle);
    }
    
    function importDeckAsNew(title) {
        const newDeck = {
            id: String(Date.now()),
            title: title, // Use the provided title (original or renamed)
            description: currentPublicDeck.description,
            words: currentPublicDeck.words.map(w => ({
                ...createNewSrsWord(w.text),
                definitions: w.definitions,
                example: w.example,
                imageUrl: w.imageUrl,
                isImageProvisional: !w.imageUrl,
                note: w.note,
                tags: w.tags,
                image_query: w.image_query || null // ADD THIS LINE
            })),
            type: currentPublicDeck.type,
            imageUrl: currentPublicDeck.image_url,
            image_query: currentPublicDeck.image_query || null, // ADD THIS LINE
            is_ai_generated: currentPublicDeck.is_ai_generated, // <-- THIS IS THE FIX
            createdAt: new Date().toISOString(),
            lastSeen: null,
            folderId: activeFolderId
        };

        decks.push(newDeck);
        saveDecksToStorage();
        
        api.callSupabaseFunction('increment-deck-download', { deck_id: currentPublicDeck.id }).catch(console.error);
        
        ui.showToast(`Deck "${newDeck.title}" imported successfully!`);
        ui.closeAllModals();
        renderDeckScreen();
        ui.showMainScreen(DOM.screens.decks, DOM.navLinks.decks);
    }

    // --- Event Handler Functions ---
    function handleSearchResultClick(e) {
        e.preventDefault(); // Stop the link from navigating
        const item = e.target.closest('.search-result-item');
        if (!item) return; // Exit if the click wasn't on a result item

        const folderId = item.dataset.folderId; // THE FIX
        const deckId = item.dataset.deckId;
        const wordDeckId = item.dataset.wordDeckId;
        const wordText = item.dataset.word;

        if (folderId) { // THE FIX: Handle folder clicks
            setDeckView('folder_' + folderId, folderId);
            const folder = folders.find(f => f.id === folderId);
            DOM.decksScreenTitle.textContent = folder ? folder.name : 'Folder';
            renderDeckScreen();
            // Clear search results to show the folder view
            DOM.mainSearchInput.value = '';
            ui.handleSearch('', decks, folders);
        } else if (deckId) {
            // A deck was clicked
            const deckToOpen = decks.find(d => d.id === deckId);
            if (deckToOpen) {
                openDeck(deckToOpen);
            }
        } else if (wordDeckId && wordText) {
            // A word was clicked
            const deckToOpen = decks.find(d => d.id === wordDeckId);
            if (deckToOpen) {
                // Open the deck and specify which word to show first
                openDeck(deckToOpen, wordText);
            }
        }
    }
    function handleDeckGridClick(e) {
        // THE FIX: "Consume" the click event that fires immediately after a long press
        if (longPressJustFinished) {
            longPressJustFinished = false;
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        // --- NEW: Handle the special "View All" card on the home screen ---
        if (e.target.closest('#view-all-decks-btn')) {
            e.preventDefault();
            ui.showMainScreen(DOM.screens.decks, DOM.navLinks.decks);
            currentDeckView = 'all';
            renderDeckScreen();
            return;
        }
        
        // Find the deck card by its data attribute, which is on both grid and list items
        const card = e.target.closest('[data-deck-id]'); // THIS IS THE FIX
        if (!card) return;

        // If in selection mode, any click on the card is a toggle
        if (isSelectionMode.decks) {
            e.preventDefault();
            e.stopPropagation();
            toggleSelection('decks', card); // THE FIX
            return;
        }

        // If NOT in selection mode, handle normal actions
        const optionsBtn = e.target.closest('.deck-options-btn');
        if (optionsBtn) {
            e.preventDefault();
            e.stopPropagation();
            const menu = optionsBtn.closest('.options-container')?.querySelector('.options-menu');
            if (menu) ui.toggleMenu(menu, 'options');
            return;
        }

        const menuItem = e.target.closest('.option-item');
        if (menuItem) {
            // Menu item clicks are handled by the body listener, so just return
            return;
        }

        // If the click was on the card but not a button, open the deck
        // The pressTimer check was removed as it was flawed. 
        // The long-press logic correctly enters selection mode, and this click handler
        // will now correctly handle simple taps.
        e.preventDefault();
        const deckId = card.dataset.deckId;
        const deck = decks.find(d => d.id == deckId);
        if (deck) openDeck(deck);
    }
    


    async function createSmartDeckFromMovie(movie) {
        const loadingToastId = 'smart-deck-loader'; // Unique ID for our toast
        ui.showToast("AI is analyzing subtitles...", false, loadingToastId, true); // Show persistent toast

        try {
            const prompt = `You are an expert ESL/EFL linguist who creates advanced learning materials from authentic media. Your task is to analyze the provided movie subtitles and extract lines suitable for a learner who has already mastered intermediate English.

From the subtitles for "${movie.title}", extract at least 40 lines that meet one or more of these criteria:
1.  **Advanced Vocabulary:** Words rarely used in casual speech but natural in high-level dialogue.
2.  **Complex Idioms/Phrasal Verbs:** Sophisticated expressions, not beginner-level clichés.
3.  **Rare or Sophisticated Collocations:** Natural but challenging word pairings.
4.  **Nuanced Tone/Style:** Lines demonstrating subtle emotion, irony, or high-level conversational style.
5.  **Advanced Contractions/Reductions:** Rare or nuanced spoken forms.

**Instructions for each extracted line:**
- Create a \`card_text\` by slightly cleaning up the original line for a flashcard (e.g., remove stutters like "uhm").
- Provide an \`explanation\` that deconstructs *why* the line is advanced. Define the specific word, explain the idiom, or analyze the tone. **Focus only on the language, not the movie's plot.**
- Include the \`original_line\` for context.
- **CRITICAL:** You must also include the original \`original_line_number\` that was provided with the subtitle.

You MUST respond with ONLY a valid JSON object. The object must have a single key "advanced_lines", which is an array of objects. Each object must have three string keys (\`card_text\`, \`explanation\`, \`original_line\`) and one number key (\`original_line_number\`).

Do not include any text or explanations outside of this JSON structure.

Here are the subtitles (Format: Number, Text):
---
---
${movie.srtContent}
---`;

    const responseText = await api.getGeminiCompletion([{ role: 'user', parts: [{ text: prompt }] }]);
            
            const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```|({[\s\S]*})/);
            if (!jsonMatch) {
                throw new Error("AI did not return a recognizable JSON object.");
            }
            
            const jsonString = jsonMatch[1] || jsonMatch[2];
            const aiData = JSON.parse(jsonString);

            if (!aiData.advanced_lines || !Array.isArray(aiData.advanced_lines)) {
                 throw new Error("AI response is missing the 'advanced_lines' array.");
            }

            // Create a fast lookup map to find timestamps by line number
            const subtitleMap = new Map(movie.subtitles.map(sub => [String(sub.number), sub.timestamp]));

            const newCards = aiData.advanced_lines.map(item => {
                const newWord = createNewSrsWord(item.card_text); // Use the correct factory function
                newWord.definitions.flashcard = item.explanation;
                newWord.definitions.detailed = item.explanation;
                newWord.example = item.original_line;
                newWord.note = `From "${movie.title}"`;
                
                // Look up the timestamp using the line number from the AI's response
                if (item.original_line_number) {
                    newWord.timestamp = subtitleMap.get(String(item.original_line_number));
                }
                
                return newWord;
            });

            const newSmartDeck = {
                id: 'deck_' + movie.id,
                title: movie.title,
                description: `AI-generated advanced dialogue from the movie ${movie.title}.`,
                words: newCards,
                type: 'Subtitle',
                imageUrl: movie.poster,
                is_ai_generated: true, // Add this line
                createdAt: new Date().toISOString(),
                lastSeen: null
            };
            
            decks.unshift(newSmartDeck);
            saveDecksToStorage();
            renderDeckScreen();
            ui.hideToast(loadingToastId); // Hide loading toast
            ui.showToast(`Smart Deck for "${movie.title}" created with ${newCards.length} lines!`);
            
            // --- THE FIX: More robust deck opening ---
            if (newSmartDeck && typeof openDeck === 'function') {
                // console.log("[Smart Deck LOG] New deck created. Attempting to open:", newSmartDeck.title);
                // openDeck(newSmartDeck); // DISABLED to prevent blank screen bug.
                // console.log("[Smart Deck LOG] Called openDeck for new smart deck.");
            } else {
                 console.error("[Smart Deck] FAILED to open deck automatically. newSmartDeck or openDeck function is invalid.");
            }

        } catch (error) {
            console.error("Error creating Smart Deck:", error);
            ui.hideToast(loadingToastId); // Hide loading toast on error too
            ui.showToast(`Failed to create Smart Deck: ${error.message}`, true);
        }
    }
// New helper to create placeholder word objects
function createPlaceholderWordObjects(wordStrings) {
    // This now uses the createNewSrsWord function from your new srs.js file!
    return wordStrings.map(text => createNewSrsWord(text));
}








        

    
    // --- NEW: Reusable Image Search Modal Logic ---
    function openImageSearchModal(context) {
        imageSearchContext = context;
        const searchInput = document.getElementById('image-search-input');
        const modalTitle = document.querySelector('#image-search-modal .header-title');
        const sourceToggle = document.getElementById('image-source-toggle-checkbox');
        
        searchInput.value = '';
        document.getElementById('image-search-results-grid').innerHTML = '<p class="no-results-message">Search for an image to begin.</p>';
        document.getElementById('image-search-status').style.display = 'none';
        document.getElementById('image-search-pagination').classList.remove('visible'); // THE FIX: Hide pagination on open
        
        // Determine initial state of the toggle
        const useGoogle = context.searchProvider === 'google';
        sourceToggle.checked = useGoogle;

        // Pre-fill search and customize modal based on context
        let placeholder = useGoogle ? 'Search Google Images...' : 'Search Unsplash...';
        if (context.type === 'deck') {
            const deck = decks.find(d => d.id === context.id);
            if (deck) {
                // THE FIX: Prioritize the saved query, then the title.
                searchInput.value = deck.image_query || deck.title;
            }
            modalTitle.textContent = "Search Cover Image";
        } else if (context.type === 'word') {
            const deck = decks.find(d => d.id === context.id);
            const word = deck?.words.find(w => w.text === context.wordText);
            if (word) {
                // THE FIX: Prioritize the saved query, then the word's text.
                searchInput.value = word.image_query || context.wordText;
            } else {
                searchInput.value = context.wordText;
}
            modalTitle.textContent = "Search Word Image";
        } else if (context.type === 'movie_poster') {
            searchInput.value = context.defaultQuery || '';
            modalTitle.textContent = "Search Movie Poster";
        }
        searchInput.placeholder = placeholder;

        ui.showModal(DOM.screens.imageSearch);
        searchInput.focus();
    }

    async function handleImageSearch() {
        const query = document.getElementById('image-search-input').value.trim();
        if (!query) return;

        const grid = document.getElementById('image-search-results-grid');
        const status = document.getElementById('image-search-status');
        const paginationControls = document.getElementById('image-search-pagination');

        grid.innerHTML = Array.from({ length: 8 }).map(() => `<div class="image-result-card loading"></div>`).join('');
        status.style.display = 'none';
        paginationControls.classList.remove('visible');
        imageSearchResults = [];

        // --- NEW: Use the toggle's state to decide which API to call ---
        let results;
        const useGoogle = document.getElementById('image-source-toggle-checkbox').checked;
        
        if (useGoogle) {
            results = await api.searchGoogleImages(query);
        } else {
            results = await api.searchUnsplash(query, 30);
        }
        
        if (results.error || !results.images || results.images.length === 0) {
            grid.innerHTML = '';
            status.style.display = 'block';
            status.textContent = results.error || `No results found for "${query}".`;
        } else {
            // THE FIX: Check the toggle state directly instead of the initial context
            const useGoogle = document.getElementById('image-source-toggle-checkbox').checked;
            
            imageSearchResults = results.images;
            imageSearchCurrentPage = 1;

            if (useGoogle) {
                // For Google, just show the results without pagination
                document.getElementById('image-search-pagination').classList.remove('visible');
                renderImageSearchPage(false); 
            } else {
                // For Unsplash, show the results and enable pagination
                renderImageSearchPage(true);
            }
        }
    }

    // --- NEW HELPER FOR PAGINATION ---
    function renderImageSearchPage(showPagination = true) {
        const grid = document.getElementById('image-search-results-grid');
        const status = document.getElementById('image-search-status');
        const paginationControls = document.getElementById('image-search-pagination');
        
        grid.innerHTML = '';
        status.style.display = 'none';

        let imagesToDisplay = [];
        const totalPages = Math.ceil(imageSearchResults.length / IMAGES_PER_PAGE);

        // THE FIX: Centralize the visibility logic here
        if (showPagination && totalPages > 1) {
            paginationControls.classList.add('visible');
            const start = (imageSearchCurrentPage - 1) * IMAGES_PER_PAGE;
            const end = start + IMAGES_PER_PAGE;
            imagesToDisplay = imageSearchResults.slice(start, end);
            
            document.getElementById('image-search-page-indicator').textContent = `${imageSearchCurrentPage} / ${totalPages}`;
            document.getElementById('image-search-prev-btn').disabled = imageSearchCurrentPage === 1;
            document.getElementById('image-search-next-btn').disabled = imageSearchCurrentPage === totalPages;
        } else {
            // This 'else' block now correctly handles BOTH Google search AND Unsplash searches with 1 page or less.
            paginationControls.classList.remove('visible');
            imagesToDisplay = imageSearchResults; // Show all results
        }

        if (imagesToDisplay.length === 0) {
            status.style.display = 'block';
            status.textContent = "No images to display.";
            return;
        }

        imagesToDisplay.forEach(img => {
            grid.innerHTML += `<div class="image-result-card" data-image-url="${img.url}" style="background-image: url('${img.url}')"></div>`;
        });
    }

    function showImageConfirmation(imageUrl) {
        selectedImageUrl = imageUrl;
        document.getElementById('image-confirm-preview').style.backgroundImage = `url('${imageUrl}')`;
        DOM.screens.imageConfirmOverlay.classList.add('active');
    }

    async function handleImageSelection(imageUrl) {
        const { type, id, wordText } = imageSearchContext;
        let finalUrl = imageUrl;
        const lastQuery = document.getElementById('image-search-input').value.trim(); // THE FIX: Capture the query

        // --- NEW: UPLOAD TO SUPABASE FOR MOVIE POSTERS ---
        if (type === 'movie_poster') {
            const toastId = 'poster-upload';
            ui.showToast("Uploading poster to your library...", false, toastId, true);
            try {
                const result = await api.callSupabaseFunction('image-proxy-uploader', {
                    imageUrl: imageUrl,
                    bucketName: 'movie_posters'
                });
                if (result.error) throw new Error(result.error);
                finalUrl = result.publicUrl;
                ui.hideToast(toastId);
            } catch (error) {
                ui.hideToast(toastId);
                ui.showToast(`Poster upload failed: ${error.message}`, true);
                return; // Stop the process
            }
        }
        
        if (type === 'deck') {
            const deck = decks.find(d => d.id === id);
            if (deck) {
                deck.imageUrl = finalUrl;
                deck.image_query = lastQuery; // THE FIX: Save the last search query
            }
        } else if (type === 'word') {
            const deck = decks.find(d => d.id === id);
            const word = deck?.words.find(w => w.text === wordText);
            if (word) {
                word.imageUrl = finalUrl;
                word.image_query = lastQuery; // THE FIX: Save the last search query
                word.isImageProvisional = false;
            }
        } else if (type === 'movie_poster_update') {
            // This is our new action for updating an existing movie's poster
            const allMovies = movie.getMovies();
            const movieToUpdate = allMovies.find(m => m.id === id);
            if (movieToUpdate) {
                movieToUpdate.poster = finalUrl;
                movieToUpdate.image_query = lastQuery; // THE FIX: Save query for movies too
                localStorage.setItem('wordwiseMovies', JSON.stringify(allMovies)); // Save directly
                movie.showMovieDetail(id); // Re-render detail screen
                movie.renderMoviesList(); // Re-render main grid
            }
        }
        
        saveDecksToStorage(); // Save changes if any decks/words were modified
        renderDeckScreen();   // Re-render main screen in case deck covers changed

        // --- NEW, CORRECTED MODAL HANDLING LOGIC ---
        if (type === 'movie_poster') {
            // For a movie poster, we just go back to the "Add Movie" modal.
            // We are ALREADY there, we just need to close the modals on top of it.
            ui.showModal(DOM.screens.addMovie);
        } else {
            // For all other types (deck/word), close everything and go back to the main app view.
            ui.closeAllModals(true);
        }
        
        // If we were editing a word, we need to refresh the deck viewer specifically
        if (type === 'word') {
            const deck = decks.find(d => d.id === id);
            deckViewer.openDeck(deck, wordText);
        }
    }

        async function refineWordImagesInBackground() {
    if (!automationSettings.enableImageAutomation) {
        console.log("⚙️ [BG Refiner] Disabled via settings. Worker is idle.");
        return;
    }
    if (!navigator.onLine) {
        console.log("⚙️ [BG Refiner] Offline. Skipping image refinement process.");
        return;
    }
    
    console.log("⚙️ [BG Refiner] Starting background image refinement process...");
    const wordsToRefine = [];
    decks.forEach(deck => {
        // Skip special system decks and decks blacklisted from image automation
        if (deck.isSpecial || automationSettings.imageAutomationDeckTypes.blacklist.includes(deck.id)) {
            return;
        }
        // Also skip deck types that have image automation disabled
        const deckType = deck.type || 'Vocabulary';
        if (automationSettings.imageAutomationDeckTypes[deckType] === false) {
            return;
        }

        deck.words.forEach(word => {
            // THE CRITICAL FIX: Only add words that are explicitly marked as having a provisional image.
            if (word.isImageProvisional === true) {
                wordsToRefine.push({ ...word, deckId: deck.id });
            }
        });
    });

    if (wordsToRefine.length === 0) {
        console.log("⚙️ [BG Refiner] No provisional images found to refine. Worker is idle.");
        return;
    }

    console.log(`⚙️ [BG Refiner] Found ${wordsToRefine.length} images in the queue to refine.`);

    // --- NEW: Session Limit for Background Refinement ---
    const REFINEMENT_LIMIT_PER_SESSION = 25;
    let refinedInThisSession = 0;

    try {
        for (const wordWithContext of wordsToRefine) {
            // --- NEW: Check if we've hit the session limit ---
            if (refinedInThisSession >= REFINEMENT_LIMIT_PER_SESSION) {
                console.log(`🏁 [BG Refiner] Reached session limit of ${REFINEMENT_LIMIT_PER_SESSION}. Pausing until next app load.`);
                ui.showToast(`AI refined ${refinedInThisSession} images. More will be refined next time you open the app.`);
                return; // Gracefully exit the function
            }

            // Find the original deck object
            const deck = decks.find(d => d.id === wordWithContext.deckId);
            if (!deck) continue;

            // --- NEW: Check if this deck type is enabled for image refinement ---
            const deckType = deck.type || 'Vocabulary';
            if (automationSettings.imageAutomationDeckTypes[deckType] === false) { // THE FIX
                console.log(`🚫 [BG Refiner] Skipping "${wordWithContext.text}" because refinement is disabled for "${deckType}" decks.`);
                continue; // Skip to the next word
            }
            // Check if the deck is in the blacklist for this specific feature
            if (automationSettings.imageAutomationDeckTypes.blacklist.includes(deck.id)) { // THE FIX
                console.log(`🚫 [BG Refiner] Skipping "${wordWithContext.text}" because the deck "${deck.title}" is blacklisted for image upgrades.`);
                continue;
            }
            // (Placeholder for blacklist logic)
            // if (automationSettings.betterImageDeckTypes.blacklist.includes(deck.id)) {
            //     console.log(`🚫 [BG Refiner] Skipping "${wordWithContext.text}" because the deck "${deck.title}" is blacklisted.`);
            //     continue;
            // }

            // Find the original word object
            const word = deck.words.find(w => w.text === wordWithContext.text);
            if (!word) continue;

            // Now, proceed with the rest of the original logic
            const result = await getBestImageUsingAI(word, deck);

            if (result === null) {
                console.log(`🤷 [BG Refiner] AI completed analysis but rejected all images for "${word.text}". Marking as done.`);
                word.isImageProvisional = false;
                saveDecksToStorage();
            } else if (result && result.imageUrl) {
                console.log(`✅ [BG Refiner] SUCCESS: Found better image for "${word.text}". Updating...`);
                word.imageUrl = result.imageUrl;
                word.image_query = result.query;
                word.isImageProvisional = false;
                saveDecksToStorage();

                // Live UI Refresh Logic
                const homeWord = home.getCurrentHomeWord();
                if (DOM.screens.home.classList.contains('active') && homeWord && homeWord.text === word.text) {
                    console.log(`[BG Refiner] Refreshing active home screen flashcard for "${word.text}".`);
                    home.showHomeScreen();
                }

                const viewerWord = deckViewer.getCurrentWord();
                if (DOM.screens.viewDeck.classList.contains('active') && viewerWord && viewerWord.text === word.text) {
                    console.log(`[BG Refiner] Refreshing active deck viewer for "${word.text}".`);
                    const currentDeck = deckViewer.getCurrentDeck();
                    if (currentDeck) {
                        deckViewer.openDeck(currentDeck, viewerWord.text);
                    }
                }

            } else {
                console.log(`❌ [BG Refiner] FAILED: Could not analyze "${word.text}" due to a probable network or API key error. It will be retried later.`);
            }
            
            refinedInThisSession++; // Increment the counter after each attempt

            // Don't wait on the very last item in the queue or the last item before the limit
            if (refinedInThisSession < wordsToRefine.length && refinedInThisSession < REFINEMENT_LIMIT_PER_SESSION) {
                console.log(`⏳ [BG Refiner] Waiting 10 seconds to respect API rate limits... (${refinedInThisSession}/${REFINEMENT_LIMIT_PER_SESSION})`);
                await new Promise(resolve => setTimeout(resolve, 10000));
            }
        }

        console.log("🏁 [BG Refiner] Finished all scheduled image refinements.");
    } catch (error) {
        if (error.message.includes("API rate limit exceeded")) {
            console.error(`🛑 [BG Refiner] ABORTING: ${error.message}. The process will restart on the next app load.`);
            ui.showToast("Background AI tasks paused due to API limits.", true);
        } else {
            console.error("💥 [BG Refiner] An unexpected error stopped the process:", error);
        }
    }
}
    // --- NEW: Selection Mode Functions ---
    function enterSelectionMode(type, initialElement) { // THE FIX: Pass the element directly
        isSelectionMode[type] = true;
        const screenElement = type === 'decks' ? DOM.screens.decks : (type === 'history' ? DOM.screens.quizHistory : DOM.screens.wotdLog);
        const barPrefix = type === 'decks' ? 'deck' : type;
        const deleteBar = document.getElementById(`${barPrefix}-selection-delete-bar`);
        
        screenElement.classList.add('selection-mode');
        deleteBar.classList.add('visible');

        toggleSelection(type, initialElement); // THE FIX: Pass the element
    }

    function exitSelectionMode(type) {
        if (!isSelectionMode[type]) return; // Prevent running if already exited
        isSelectionMode[type] = false;
        selectedIds[type].clear();

        const screenElement = type === 'decks' ? DOM.screens.decks : (type === 'history' ? DOM.screens.quizHistory : DOM.screens.wotdLog);
        const barPrefix = type === 'decks' ? 'deck' : type;
        const deleteBar = document.getElementById(`${barPrefix}-selection-delete-bar`);
        
        screenElement.classList.remove('selection-mode');
        deleteBar.classList.remove('visible');
        
        // THE FIX: Create a generic selector for all item types
        const itemSelector = type === 'decks' ? '.grid-deck-card, .deck-list-card' : (type === 'history' ? '.history-quiz-item' : '.wotd-log-entry');
        document.querySelectorAll(`${itemSelector}.selected`).forEach(el => {
            el.classList.remove('selected');
        });
    }

    function toggleSelection(type, itemElement) { // THE FIX: Pass the element directly
        if (!itemElement) return;
        
        const idAttribute = type === 'decks' ? 'data-deck-id' : (type === 'history' ? 'data-quiz-id' : 'data-wotd-id');
        const id = itemElement.getAttribute(idAttribute);
        if (!id) return;

        if (selectedIds[type].has(id)) {
            selectedIds[type].delete(id);
            itemElement.classList.remove('selected');
            console.log(`[Selection LOG] Removed .selected from element with id: ${id}`);
        } else {
            selectedIds[type].add(id);
            itemElement.classList.add('selected');
            console.log(`[Selection LOG] Added .selected to element with id: ${id}`);
        }

        updateSelectionBar(type);
    }

    function updateSelectionBar(type) {
        const count = selectedIds[type].size;
        
        if (count === 0) {
            exitSelectionMode(type);
            return;
        }

        if (type === 'decks') {
            document.getElementById('deck-selection-move-count').textContent = `Move ${count}`;
            document.getElementById('deck-selection-count').textContent = `Delete ${count}`;

            // --- NEW: Pin button logic ---
            const pinBtnText = document.getElementById('deck-selection-pin-text');
            const pinBtnIcon = document.getElementById('deck-selection-pin-btn').querySelector('i');
            const selectedDecks = Array.from(selectedIds.decks).map(id => decks.find(d => d.id === id));
            // If SOME of the selected decks are NOT pinned, the action will be to "Pin"
            const shouldPin = selectedDecks.some(deck => !deck.isPinned); 
            
            if (shouldPin) {
                pinBtnText.textContent = `Pin ${count}`;
                pinBtnIcon.className = 'ph ph-push-pin';
            } else {
                // Otherwise (if ALL are already pinned), the action is to "Unpin"
                pinBtnText.textContent = `Unpin ${count}`;
                pinBtnIcon.className = 'ph ph-push-pin-slash';
            }
            // --- END NEW ---

            // Get references to all single-action buttons and their divider
            const singleActionDivider = document.getElementById('deck-selection-single-action-divider');
            const testBtn = document.getElementById('deck-selection-test-btn');
            const editBtn = document.getElementById('deck-selection-edit-btn');
            const uploadBtn = document.getElementById('deck-selection-upload-btn');
            const logBtn = document.getElementById('deck-selection-log-btn');

            if (count === 1) {
                // If only one deck is selected, show the relevant single-action buttons
                const [deckId] = selectedIds.decks;
                const deck = decks.find(d => d.id === deckId);
                
                singleActionDivider.style.display = 'block';
                testBtn.style.display = 'flex';
                
                if (deck.isSpecial) {
                    logBtn.style.display = 'flex';
                    editBtn.style.display = 'none';
                    uploadBtn.style.display = 'none';
                } else {
                    editBtn.style.display = 'flex';
                    uploadBtn.style.display = 'flex';
                    logBtn.style.display = 'none';
                }
            } else {
                // If multiple decks are selected, hide all single-action buttons
                singleActionDivider.style.display = 'none';
                testBtn.style.display = 'none';
                editBtn.style.display = 'none';
                uploadBtn.style.display = 'none';
                logBtn.style.display = 'none';
            }

        } else if (type === 'history') {
            const countSpan = document.getElementById('history-selection-count');
            countSpan.textContent = `Delete ${count} Item${count > 1 ? 's' : ''}`;
        } else if (type === 'wotd') {
            const countSpan = document.getElementById('wotd-selection-count');
            countSpan.textContent = `Delete ${count} Item${count > 1 ? 's' : ''}`;
        }
    }

// --- NEW: Hierarchical Move-to-Folder Logic ---
function getFolderPath(folderId) {
    if (!folderId) return "Move to...";
    let path = [];
    let currentFolder = folders.find(f => f.id === folderId);
    while (currentFolder) {
        path.unshift(currentFolder.name);
        currentFolder = folders.find(f => f.id === currentFolder.parentId);
    }
    return `Move to... / ${path.join(' / ')}`;
}

function renderMoveToFolderList(parentId = null) {
    const listEl = document.getElementById('move-to-folder-list');
    const headerTitleEl = document.getElementById('move-to-folder-header-title');
    const backBtn = document.getElementById('move-to-folder-back-btn');
    listEl.innerHTML = '';

    // Update header and back button
    headerTitleEl.textContent = getFolderPath(parentId);
    if (parentId) {
        const parentFolder = folders.find(f => f.id === parentId);
        backBtn.dataset.parentId = parentFolder?.parentId || 'null';
        backBtn.style.visibility = 'visible';
    } else {
        backBtn.style.visibility = 'hidden';
    }

    // Always show "Un-filed" option at the top level
    if (parentId === null) {
        listEl.innerHTML += `
            <div class="list-option" data-folder-id="null">
                <div class="list-option-main">
                    <div class="list-option-icon-wrapper"><i class="ph ph-files"></i></div>
                    <p class="list-option-text">Top Level (No Folder)</p>
                </div>
            </div>`;
    }
    
    // Get and render folders for the current level
    const foldersAtLevel = folders.filter(f => f.parentId === parentId);
    foldersAtLevel.forEach(folder => {
        const hasChildren = folders.some(f => f.parentId === folder.id);
        const selectedClass = currentMoveTargetFolderId === folder.id ? 'selected' : '';
        listEl.innerHTML += `
            <div class="list-option ${selectedClass}" data-folder-id="${folder.id}">
                <div class="list-option-main">
                    <div class="list-option-icon-wrapper"><i class="ph-fill ph-folder" style="color: ${folder.color};"></i></div>
                    <p class="list-option-text">${folder.name}</p>
                </div>
                ${hasChildren ? `<button class="drill-down-btn" data-folder-id="${folder.id}"><i class="ph ph-caret-right"></i></button>` : ''}
            </div>
        `;
    });
}

    function openMoveToFolderModal() {
        currentMoveTargetFolderId = null; // Reset selection
        const count = selectedIds.decks.size;
        const plural = count > 1 ? 's' : '';
        document.getElementById('move-to-folder-header-title').textContent = `Move ${count} Deck${plural} To...`;
        document.getElementById('confirm-move-btn').disabled = true;
        renderMoveToFolderList(null); // Start at the top level
        ui.showModal(DOM.moveToFolderModal);
    }

function handleMoveSelectedDecks(targetFolderId) {
    const idsToMove = Array.from(selectedIds.decks);
    const folderId = targetFolderId === 'null' ? null : targetFolderId;

    decks.forEach(deck => {
        if (idsToMove.includes(deck.id)) {
            deck.folderId = folderId;
        }
    });

    saveDecksToStorage();
    renderDeckScreen(); // Re-render to show decks in their new locations
    ui.closeAllModals();
    exitSelectionMode('decks');
    ui.showToast(`${idsToMove.length} deck(s) moved successfully.`);
}
// NEW FUNCTION - for one-time data migration
function migrateSrsData() {
    console.log("Checking for SRS data migration...");
    let needsSave = false;
    const oldIntervals = [1, 3, 7, 14, 30, 90, 180]; // Your old masteryIntervalsDays array

    decks.forEach(deck => {
        deck.words.forEach(word => {
            if (word.hasOwnProperty('masteryLevel')) {
                needsSave = true;
                const level = word.masteryLevel || 0;
                word.interval = level > 0 ? oldIntervals[Math.min(level - 1, oldIntervals.length - 1)] : 0;
                word.factor = 2.5; 
                delete word.masteryLevel;
            }
        });
    });

    if (needsSave) {
        console.log("Migration complete! Saving updated decks.");
        saveDecksToStorage();
    } else {
        console.log("No migration needed.");
    }
}

    // --- Initial Load ---
    async function init() {
            
            
            loadDecksFromStorage();
    loadAutomationSettings(); 
            loadStudySettings();
            loadFoldersFromStorage();
            loadApiSettings(); // --- THIS IS THE FIX ---

        // --- THE FIX: Load the last active deck view ---
        currentDeckView = localStorage.getItem('wordwiseCurrentDeckView') || 'all';
        activeFolderId = localStorage.getItem('wordwiseActiveFolderId');
        if (activeFolderId === 'null' || activeFolderId === null) {
            activeFolderId = null;
        }
        // Safety check: if a folder was deleted, default to the main folders view.
        if (currentDeckView.startsWith('folder_') && !folders.find(f => f.id === activeFolderId)) {
            currentDeckView = 'folders';
            activeFolderId = null;
        }
loadViewStates();
        loadProficiencyLog(); // <-- ADD THIS LINE
        if (!localStorage.getItem('wordwiseSrsMigrated')) {
            migrateSrsData();
            localStorage.setItem('wordwiseSrsMigrated', 'true');
            saveDecksToStorage();
        }
        
        setDefaultDeckView(localStorage.getItem('wordwiseDefaultDeckView') || 'flashcard');
        
        await initializeCoreApi(); // Call the new, safe initializer first
        
        applySavedTheme();
        
        // THE FIX: Check for and initialize Eruda console on load if it was previously active.
        if (localStorage.getItem('wordwiseErudaActive') === 'true') {
            if (typeof eruda !== 'undefined') {
                console.log("Persistent developer mode is active. Initializing Eruda console.");
                eruda.init();
                isErudaActive = true;
            }
        }

        // Check if the backend settings should be visible on load
        if (localStorage.getItem('wordwiseBackendSettingsVisible') === 'true') {
            DOM.backendSettingsWrapper.classList.add('visible');
        }
        
        // Initialize Core Modules
        backupManager.initBackupManager({
            actions: {
                showToast: ui.showToast,
                showConfirmation: showConfirmationDialog,
                promptForNewName: promptForNewName, // <-- ADD THIS LINE
                getStateForBackup: () => ({
                    decks: decks,
                    folders: folders,
                    movies: movie.getMovies(),
                    quizHistory: quiz.getQuizHistory(),
                    proficiencyLog: proficiencyLog,
                    conversations: chat.getConversations()
                }),
                setStateFromBackup: (data) => {
                    // This function is called by the backup manager after merging
                    decks = data.decks;
                    folders = data.folders;
                    proficiencyLog = data.proficiencyLog;

                    // For modules with their own state, we save to localStorage
                    // and rely on the app reload to populate them correctly.
                    localStorage.setItem('wordwiseMovies', JSON.stringify(data.movies));
                    localStorage.setItem('wordwiseQuizHistory', JSON.stringify(data.quizHistory));
                    localStorage.setItem('wordwiseConversations', JSON.stringify(data.conversations));

                    saveDecksToStorage();
                    saveFoldersToStorage();
                    saveProficiencyLog();
                }
            }
        });

        // wotd.initWotd() is now called from initializeCoreApi(), so it is removed from here.

    agent.initAgent({
        getState: () => ({ decks, folders, movies: movie.getMovies() }),
        actions: {
            showConfirmation: showConfirmationDialog, // Add this line
            onGoogleSearch: openGoogleSearchModal, // Pass the function to open the modal
            onGetCurrentWord: deckViewer.getCurrentWord, // Pass the function to get the current word
            saveDecks: saveDecksToStorage,
            saveFolders: saveFoldersToStorage,
            applyFilters: renderDeckScreen,
            openDeck: openDeck,
            addDeck: (newDeck) => {
                decks.push(newDeck);
            },
            deleteDeck: (deckId) => {
                const deckIndex = decks.findIndex(d => d.id === deckId);
                if (deckIndex > -1) {
                    decks.splice(deckIndex, 1);
                }
            },
            updateFolders: (updatedFolders) => { // <-- ADD THIS BLOCK
                folders = updatedFolders;
            },
            createNewSrsWord: createNewSrsWord,
            // --- THIS IS THE FIX ---
            onPopulateWordData: (wordObject, deck) => populateWordData(api, currentApiKeys, wordObject, deck),
onGetBestImageForQuery: getBestImageForQuery
        },
        api,
        utils: {
            formatRelativeTime,
            calculateDeckStudyScore,
            selectNextSrsWord: selectNextWord // THE FIX: Add the missing SRS function for the agent
        }
    });
        ui.initUIModule({
            elements: DOM,
            getState: () => ({ studySettings, automationSettings, supabaseUrl, supabaseAnonKey, apiSettings }), // --- THIS LINE IS MODIFIED ---
            actions: {
                onCalculateStudyScore: calculateDeckStudyScore,
                onTruncateText: (text, len) => truncateInMiddle(text, len),
                onFormatRelativeTime: formatRelativeTime,
                onMarkedParse: (text) => marked.parse(text, { breaks: true, gfm: true })
            }
        });

           deckViewer.initDeckViewer({
            elements: {
                screens: DOM.screens,
                navLinks: DOM.navLinks,
                // THE FIX: Pass the specific screen elements the module needs
                'viewDeck': DOM.screens.viewDeck,
                // NEW: Pass the header buttons so the module can control them
                headerTestBtn: document.getElementById('header-deck-test-btn'),
                headerEditBtn: document.getElementById('header-deck-edit-btn'),
                headerLogBtn: document.getElementById('header-deck-log-btn'),
                headerUploadBtn: document.getElementById('header-deck-upload-btn'),
            },
            actions: {
                onRefreshDeckScreen: renderDeckScreen, // <-- THIS IS THE NEW LINE
                getStudySettings: () => studySettings, // MOVED HERE
                getAutomationSettings: () => automationSettings, // Pass automation settings
                showConfirmation: showConfirmationDialog,
                ui, // Pass the entire ui module directly.
                onOpenImageSearch: openImageSearchModal,
showMainScreen: showMainScreenWithUpdates,
                onRefetchWordImage: handleRefetchWordImage,
                onDeleteWord: handleDeleteWordFromDeck,
                onGoogleSearch: openGoogleSearchModal,
                onLogProficiency: handleLogProficiency,
                onCallSupabaseFunction: api.callSupabaseFunction,
                onSelectNextWord: selectNextWord,
                onPopulateWordData: (wordObject, deck, maxRetries) => populateWordData(api, currentApiKeys, wordObject, deck, maxRetries),
                onSaveDecks: saveDecksToStorage,
                onUpdateSrsWord: (deckId, wordText, rating) => {
                    // THE DEFINITIVE FIX: Find the indexes to modify the main `decks` array directly.
                    const deckIndex = decks.findIndex(d => d.id === deckId);
                    if (deckIndex === -1) return;
                    
                    const wordIndex = decks[deckIndex].words.findIndex(w => w.text === wordText);
                    if (wordIndex === -1) return;

                    // This now mutates the word object within the main `decks` array in app.js
                    decks[deckIndex].words[wordIndex] = processReview(decks[deckIndex].words[wordIndex], rating);
                    
                    // Save the now-updated main `decks` array to storage.
                    saveDecksToStorage();
                },
                onDeckOpened: (deckId) => {
                    const deck = decks.find(d => d.id === deckId);
                    if (deck) {
                        deck.lastSeen = new Date().toISOString();
                        saveDecksToStorage();
                    }
                },
                onAskAi: chat.redirectToChatFromWord,
                onGoToMovieTimestamp: (deckId, timestamp) => {
                    const movieId = deckId.replace('deck_', '');
                    movie.playMovie(movieId, srtTimeToSeconds(timestamp));
                },
                onGetGroqCompletion: api.getGroqCompletion
            }
        });
        // Initialize Feature Modules

        movie.initMovieModule({
            elements: { 
                screens: DOM.screens,
                movieGrid: document.getElementById('movie-grid'),
                movieSearchResultsContainer: document.getElementById('movie-search-results-container'),
                movieListSearchInput: document.getElementById('movie-list-search-input'),
                defaultMoviesView: document.getElementById('default-movies-view'),
                movieSearchInput: document.getElementById('movie-search-input'),
                movieSearchStatus: document.getElementById('movie-search-status'),
                apiSearchResult: document.getElementById('api-search-result'),
                manualEntryForm: document.getElementById('manual-entry-form'),
                movieSearchBtn: document.getElementById('movie-search-btn'),
                apiResultPoster: document.getElementById('api-result-poster'),
                apiResultTitle: document.getElementById('api-result-title'),
                apiResultYear: document.getElementById('api-result-year'),
                manualMovieTitle: document.getElementById('manual-movie-title'),
                manualMovieDescription: document.getElementById('manual-movie-description'),
                manualMoviePoster: document.getElementById('manual-movie-poster'),
                movieDetailTitle: document.getElementById('movie-detail-title'),
                movieDetailPoster: document.getElementById('movie-detail-poster'),
                movieDetailDescription: document.getElementById('movie-detail-description'),
                playerContainer: document.getElementById('player-container'),
                moviePlayerTitle: document.getElementById('movie-player-title'),
                subtitlePlayerContainer: document.getElementById('subtitle-player-container'),
                     },
         getState: () => ({ decks, supabaseUrl, supabaseAnonKey }), // Pass ONLY Supabase keys for AI checks
         actions: {
             api: api, // <-- THIS IS THE FIX
             getGroqCompletion: api.getGroqCompletion,
                getJsonFromAi: api.getJsonFromAi,
                showToast: ui.showToast,
                hideToast: ui.hideToast, // THE FIX
                showModal: ui.showModal,
                closeAllModals: ui.closeAllModals,
                toggleMenu: ui.toggleMenu,
                closeActiveMenu: ui.closeActiveMenu,
            showConfirmation: showConfirmationDialog, // THE FIX
                openImageSearch: openImageSearchModal, // ADD THIS LINE
                openDeck,
                createSmartDeckFromMovie,
                secondsToSrtTime,
                createPlaceholderWordObjects,
                addDeck: (newDeck) => {
                    decks.unshift(newDeck);
                    saveDecksToStorage();
                    renderDeckScreen();
                },
                addWordToDeck: (deckId, newWord) => {
                    const deck = decks.find(d => d.id === deckId);
                    if (deck) { deck.words.push(newWord); saveDecksToStorage(); renderDeckScreen(); }
                },
                parseSrt,
            }
        });
        quiz.initQuizModule({
            elements: { 
                screens: DOM.screens,
                navLinks: DOM.navLinks,
                trueBtn: document.getElementById('true-btn'),
                falseBtn: document.getElementById('false-btn'),
                quizDoneBtn: document.getElementById('quiz-done-btn'),
                retakeQuizBtn: document.getElementById('retake-quiz-btn'),
                mcQuizOptionsContainer: document.getElementById('mc-quiz-options-container'),
                mcQuizSubmitBtn: document.getElementById('mc-quiz-submit-btn'),
                closeQuizBtn: document.getElementById('close-quiz-btn'),
                closeMcQuizBtn: document.getElementById('close-mc-quiz-btn'),
                closeHistoryBtn: document.getElementById('close-history-btn'),
                closeReviewBtn: document.getElementById('close-review-btn'),
                quizHistoryList: document.getElementById('quiz-history-list'),
                quizHistoryDeckTitle: document.getElementById('quiz-history-deck-title'),
                noHistoryMsg: document.getElementById('no-history-msg'),
                quizQuestionTitle: document.getElementById('quiz-question-title'),
                quizCard: document.getElementById('quiz-card'),
                quizButtons: document.getElementById('quiz-buttons'),
                quizCardWord: document.getElementById('quiz-card-word'),
                quizCardDefinition: document.getElementById('quiz-card-definition'),
                quizProgressText: document.getElementById('quiz-progress-text'),
                quizProgressBar: document.getElementById('quiz-progress-bar'),
                quizResultOverlay: document.getElementById('quiz-result-overlay'),
                quizResultContent: document.getElementById('quiz-result-content'),
                quizResultIcon: document.getElementById('quiz-result-icon'),
                quizResultText: document.getElementById('quiz-result-text'),
                reviewScoreText: document.getElementById('review-score-text'),
                reviewScoreDescription: document.getElementById('review-score-description'),
                reviewList: document.getElementById('review-list'),
                mcQuizDefinition: document.getElementById('mc-quiz-definition'),
                mcQuizProgressText: document.getElementById('mc-quiz-progress-text'),
                mcQuizProgressBar: document.getElementById('mc-quiz-progress-bar'),
            },
            getState: () => ({ decks }),
            actions: {
                showConfirmation: showConfirmationDialog, // Add this line
                showToast: ui.showToast,
                showMainScreen: ui.showMainScreen,
                showModal: ui.showModal,
                closeAllModals: ui.closeAllModals,
                populateWordData: (wordObject, deck, maxRetries) => populateWordData(api, currentApiKeys, wordObject, deck, maxRetries),
             selectPrioritizedWordsForQuiz,
                getQuizFromAI: api.getQuizFromAI,
                getJsonFromAi: api.getJsonFromAi, // <-- ADD THIS LINE
                getQuizHistory: quiz.getQuizHistory,
                onLogProficiency: handleLogProficiency, // <-- ADD THIS LINE
                updateSrsWord: (deckId, wordText, rating) => {
                    const deck = decks.find(d => d.id === deckId);
                    if (!deck) return;
                    const wordIndex = deck.words.findIndex(w => w.text === wordText);
                    if (wordIndex > -1) {
                        deck.words[wordIndex] = processReview(deck.words[wordIndex], rating);
                        saveDecksToStorage();
                    }
                },
                marked: (text, options) => marked.parse(text, options),
            }
        });

        chat.initChatModule({
    elements: { screens: DOM.screens, navLinks: DOM.navLinks, fullChatElements: DOM.fullChatElements },
    getState: () => ({ decks, supabaseUrl, supabaseAnonKey }), // Pass Supabase keys for AI
    actions: {
            showConfirmation: showConfirmationDialog, // Add this line
            showMainScreen: ui.showMainScreen,
            toggleMenu: ui.toggleMenu,
            closeActiveMenu: ui.closeActiveMenu,
            selectPrioritizedWordsForQuiz,
            getGroqCompletion: api.getGroqCompletion,
            getGeminiAgentTools: () => agent.GEMINI_AGENT_TOOLS, // Get tools from the agent module
            executeAppFunction: agent.executeToolCall, // Use the agent's executor
            callSupabaseFunction: api.callSupabaseFunction // Pass the proxy function directly to chat
        }
        // genAI client is no longer needed
    });

        document.getElementById('image-search-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleImageSearch();
        });
        
        // --- NEW: Listener for image source toggle ---
        document.getElementById('image-source-toggle-checkbox').addEventListener('change', (e) => {
            const useGoogle = e.target.checked;
            const searchInput = document.getElementById('image-search-input');
            const paginationControls = document.getElementById('image-search-pagination');
            
            searchInput.placeholder = useGoogle ? 'Search Google Images...' : 'Search Unsplash...';

            // THE FIX: Hide pagination if switching to Google, show if switching back to Unsplash (and if results exist)
            if (useGoogle) {
                paginationControls.classList.remove('visible');
            } else {
                // Only show pagination if there are enough Unsplash results to warrant it
                const totalPages = Math.ceil(imageSearchResults.length / IMAGES_PER_PAGE);
                if (totalPages > 1) {
                    paginationControls.classList.add('visible');
                }
            }
        });

        // Initialize Deck Manager
        deckManager.initDeckManager({
            elements: {
            // Pass the new modal directly
            addDeckSourceChoiceModal: document.getElementById('add-deck-source-choice-modal'), 
            screens: DOM.screens,
            navLinks: DOM.navLinks,
            ...DOM, // Pass all specific elements
        },
                actions: {
                handleOpenSimpleWordEditor: deckManager.handleOpenSimpleWordEditor, // THE FIX
                handleSaveSimpleWords: deckManager.handleSaveSimpleWords,       // THE FIX
                showConfirmation: showConfirmationDialog,
                ui, // Pass the entire ui module
                api, 
                getState: () => ({ decks, activeFolderId }),
                onGetBestImageForQuery: getBestImageForQuery, 
                onOpenImageSearch: openImageSearchModal,
                onCreateNewSrsWord: createNewSrsWord,
            onAddDeck: (newDeck) => {
                    decks.push(newDeck);
                    saveDecksToStorage();
                    renderDeckScreen();
                },
                onUpdateDeck: (updatedDeck) => {
                    const deckIndex = decks.findIndex(d => d.id === updatedDeck.id);
                    if (deckIndex > -1) {
                        // Preserve properties not managed by the form
                        const oldDeck = decks[deckIndex];
                        decks[deckIndex] = {
                            ...oldDeck,
                            ...updatedDeck
                        };
                        saveDecksToStorage();
                        renderDeckScreen();
                    }
                },
                onDeleteDeck: (deckId) => {
                    decks = decks.filter(d => d.id !== deckId);
                    saveDecksToStorage();
                    renderDeckScreen();
                }
            }
        });

        home.initHome({
        elements: DOM,
        actions: {
            ui,
            api,
            wotd, // Pass the entire wotd module
            getState: () => ({ decks, automationSettings }),
            onSelectNextWord: selectNextWord,
         onPopulateWordData: (wordObject, deck, maxRetries) => populateWordData(api, currentApiKeys, wordObject, deck, maxRetries),
            onUpdateSrsWord: (deckId, wordText, rating) => {
                const deck = decks.find(d => d.id === deckId);
                if (!deck) return;
                const wordIndex = deck.words.findIndex(w => w.text === wordText);
                if (wordIndex > -1) {
                    deck.words[wordIndex] = processReview(deck.words[wordIndex], rating);
                    saveDecksToStorage();
                }
            },
            onViewDeck: (deckId, wordText) => {
                const deckToOpen = decks.find(d => d.id === deckId);
                if (deckToOpen) {
                    openDeck(deckToOpen, wordText);
                }
            },
            onAskAi: chat.redirectToChatFromWord,
            onGoToMovieTimestamp: (deckId, timestamp) => {
                const movieId = deckId.replace('deck_', '');
                movie.playMovie(movieId, srtTimeToSeconds(timestamp));
            }
        }
    });

    // Setup Listeners & Initial Render
    setupEventListeners();

    

    await wotd.processWordOfTheDay(); // Ensure WotD is updated before rendering anything
    refineWordImagesInBackground();
    renderDeckScreen();
    movie.renderMoviesList();
    
    // Show home screen and let the home module populate its content
    ui.showMainScreen(DOM.screens.home, DOM.navLinks.home);
    home.showHomeScreen();

    }
init();
});